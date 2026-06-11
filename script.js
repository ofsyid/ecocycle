// ─── CONFIG ──────────────────────────────────────────────────
// GANTI DENGAN IP ESP32 SENSOR ANDA (dari Serial Monitor)
const ESP32_IP = "10.37.109.226";
const FETCH_INTERVAL = 2000;     // ms polling interval
const OFFLINE_TIMEOUT = 6000;    // ms — jika tidak ada respon > 6 detik → offline
 
// ─── AUTO-PRESS UI STATE ──────────────────────────────────────
// Tidak ada tombol manual — press dikontrol penuh oleh ESP32.
// Script hanya menampilkan status yang dikirim dari /data.
let _prevAutoRunning = false;
let _prevPressStage  = 0;
 
// ─── State ────────────────────────────────────────────────────
const state = {
  temp: 0,
  humidity: 0,
  gas: 0,
  fillPct: 0,
  isPress: false,
  isFull: false,
  esp32Connected: false,        // status koneksi ESP32
  lastSuccessTime: null,        // waktu terakhir data berhasil diterima
  sensorErrors: {               // status per-sensor
    temp: false,
    humidity: false,
    gas: false,
    fill: false
  }
};
 
// ─── History ──────────────────────────────────────────────────
const history = { labels: [], temp: [], humid: [], gas: [] };
 
for (let i = 60; i >= 0; i--) {
  const t = new Date(Date.now() - i * 60000);
  history.labels.push(
    t.getHours().toString().padStart(2,'0') + ':' +
    t.getMinutes().toString().padStart(2,'0')
  );
  history.temp.push(0);
  history.humid.push(0);
  history.gas.push(0);
}
 
// ─── Clock ────────────────────────────────────────────────────
function updateClock() {
  const now = new Date();
  document.getElementById('clock').textContent =
    now.getHours().toString().padStart(2,'0') + ':' +
    now.getMinutes().toString().padStart(2,'0') + ':' +
    now.getSeconds().toString().padStart(2,'0');
 
  const dateStr =
    now.getFullYear() + '-' +
    (now.getMonth()+1).toString().padStart(2,'0') + '-' +
    now.getDate().toString().padStart(2,'0') + ' · ' +
    now.getHours().toString().padStart(2,'0') + ':' +
    now.getMinutes().toString().padStart(2,'0') + ':' +
    now.getSeconds().toString().padStart(2,'0');
 
  document.getElementById('camTimestamp').textContent = dateStr;
  document.getElementById('alertTime').textContent =
    now.getHours().toString().padStart(2,'0') + ':' +
    now.getMinutes().toString().padStart(2,'0');
}
setInterval(updateClock, 1000);
updateClock();
 
// ─── Sparkline Charts ─────────────────────────────────────────
function makeSparkline(id, data, color) {
  const ctx = document.getElementById(id).getContext('2d');
  return new Chart(ctx, {
    type: 'line',
    data: {
      labels: new Array(data.length).fill(''),
      datasets: [{
        data,
        borderColor: color,
        borderWidth: 1.5,
        fill: true,
        backgroundColor: color.replace(')', ',0.1)').replace('rgb','rgba'),
        pointRadius: 0,
        tension: 0.4
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: { legend: { display: false } },
      scales: { x: { display: false }, y: { display: false } },
      animation: false
    }
  });
}
 
const sparkTemp = makeSparkline('tempChart', history.temp.slice(-20), '#fbbf24');
const sparkHum  = makeSparkline('humChart',  history.humid.slice(-20), '#60a5fa');
const sparkGas  = makeSparkline('gasChart',  history.gas.slice(-20), '#a78bfa');
 
// ─── Main Chart ───────────────────────────────────────────────
let currentTab = 'suhu';
const mainCtx = document.getElementById('mainChart').getContext('2d');
const mainChart = new Chart(mainCtx, {
  type: 'line',
  data: {
    labels: history.labels,
    datasets: [{
      data: history.temp,
      borderColor: '#fbbf24',
      backgroundColor: 'rgba(251,191,36,0.05)',
      borderWidth: 1.5,
      fill: true,
      pointRadius: 0,
      tension: 0.4
    }]
  },
  options: {
    responsive: true,
    maintainAspectRatio: false,
    plugins: { legend: { display: false } },
    scales: {
      x: {
        display: true,
        ticks: { color: '#4b5563', font: { family: 'JetBrains Mono', size: 9 }, maxTicksLimit: 8, maxRotation: 0 },
        grid: { color: 'rgba(255,255,255,0.03)' }
      },
      y: {
        display: true,
        ticks: { color: '#4b5563', font: { family: 'JetBrains Mono', size: 9 } },
        grid: { color: 'rgba(255,255,255,0.04)' }
      }
    },
    animation: { duration: 300 }
  }
});
 
window.switchTab = function(tab, el) {
  currentTab = tab;
  document.querySelectorAll('.chart-tab').forEach(t => t.classList.remove('active'));
  el.classList.add('active');
  const configs = {
    suhu:  { data: history.temp,  color: '#fbbf24' },
    humid: { data: history.humid, color: '#60a5fa' },
    gas:   { data: history.gas,   color: '#a78bfa' }
  };
  const c = configs[tab];
  mainChart.data.datasets[0].data = c.data;
  mainChart.data.datasets[0].borderColor = c.color;
  mainChart.update();
};
 
// ─── Log System ───────────────────────────────────────────────
const logs = [];
function addLog(msg, color, time) {
  logs.unshift({ msg, color, time: time || new Date().toLocaleTimeString('id-ID') });
  if (logs.length > 8) logs.pop();
  renderLogs();
}
function renderLogs() {
  const c = document.getElementById('logContainer');
  c.innerHTML = logs.map(l => `
    <div class="log-entry">
      <div class="log-dot" style="background:${l.color}"></div>
      <div>
        <div class="log-msg">${l.msg}</div>
        <div class="log-time">${l.time}</div>
      </div>
    </div>
  `).join('');
}
addLog('Sistem monitoring aktif — menunggu ESP32…', '#6b7280');
 
// ─── Bin Fill ─────────────────────────────────────────────────
function updateBinFill(pct) {
  if (isNaN(pct) || pct < 0 || pct > 100) pct = 0;
  const maxHeight = 124;
  const fillHeight = (pct / 100) * maxHeight;
  const fillY = 56 + (maxHeight - fillHeight);
  document.getElementById('fillLevel').setAttribute('y', fillY);
  document.getElementById('fillLevel').setAttribute('height', fillHeight);
  document.getElementById('fillPct').textContent = pct + '%';
 
  const beratSampah    = (pct * 0.2).toFixed(1);
  const sisaKapasitas  = (20 - beratSampah).toFixed(1);
  document.getElementById('fillKg').textContent   = beratSampah + ' kg';
  document.getElementById('fillSisa').textContent = sisaKapasitas + ' kg';
 
  const bar = document.getElementById('fillBar');
  bar.style.width = pct + '%';
 
  if (pct >= 95) {
    document.getElementById('alertBanner').style.display = 'flex';
  } else {
    document.getElementById('alertBanner').style.display = 'none';
  }
}
 
// ─── UI: ESP32 OFFLINE ────────────────────────────────────────
function setOfflineUI() {
  const wasConnected = state.esp32Connected;
  state.esp32Connected = false;
 
  // Reset semua nilai sensor ke 0
  state.temp     = 0;
  state.humidity = 0;
  state.gas      = 0;
  state.fillPct  = 0;
 
  // Kartu Suhu
  document.getElementById('tempVal').innerHTML =
    `0<span class="card-unit">°C</span>`;
  document.getElementById('tempStatus').textContent =
    '⚠ ESP32 tidak terhubung';
 
  // Kartu Kelembapan
  document.getElementById('humVal').innerHTML =
    `0<span class="card-unit">%</span>`;
  document.getElementById('humStatus').textContent =
    '⚠ ESP32 tidak terhubung';
 
  // Kartu Gas
  document.getElementById('gasVal').innerHTML =
    `0<span class="card-unit">ppm</span>`;
  document.getElementById('gasStatus').textContent =
    '⚠ ESP32 tidak terhubung';
 
  // Bin
  updateBinFill(0);
 
  // Status dots → merah / kedip lambat
  setCardDotStatus('tempDot',  false);
  setCardDotStatus('humDot',   false);
  setCardDotStatus('gasDot',   false);
  setCardDotStatus('pressDot', false);
 
  // Live badge → offline
  const liveBadge = document.querySelector('.live-badge');
  if (liveBadge) {
    liveBadge.style.borderColor = 'rgba(239,68,68,0.4)';
    liveBadge.style.color       = '#ef4444';
    const dot = liveBadge.querySelector('.live-dot');
    if (dot) dot.style.background = '#ef4444';
    liveBadge.childNodes[1] && (liveBadge.childNodes[1].textContent = ' OFFLINE');
  }
 
  // Status panel — Koneksi Sensor
  const sensorChip = document.getElementById('sensorChip');
  const sensorDesc = document.getElementById('sensorDesc');
  if (sensorChip) {
    sensorChip.textContent  = 'TERPUTUS';
    sensorChip.className    = 'status-chip chip-err';
  }
  if (sensorDesc) {
    sensorDesc.textContent = 'ESP32 tidak merespons';
  }
 
  // Gas status panel
  const gasChip = document.getElementById('gasChip');
  if (gasChip) { gasChip.textContent = '—'; gasChip.className = 'status-chip chip-err'; }
 
  // Press
  document.getElementById('pressLabel').textContent = 'TIDAK TERHUBUNG';
  document.getElementById('pressLabel').style.color = '#ef4444';
  document.getElementById('pressSub').textContent   = 'Menunggu koneksi ESP32…';
  const offIcon = document.getElementById('pressIcon');
  if (offIcon) offIcon.textContent = '⏸️';
  const offTimer = document.getElementById('autoTimerLabel');
  if (offTimer) { offTimer.textContent = '—'; offTimer.style.color = '#6b7280'; }
  const offFill = document.getElementById('autoFillBar');
  if (offFill) offFill.style.width = '0%';
  const offCooldown = document.getElementById('cooldownBadge');
  if (offCooldown) offCooldown.style.display = 'none';
 
  if (wasConnected) {
    addLog('⚠ ESP32 terputus — menunggu koneksi ulang', '#ef4444');
  }
}
 
// ─── UI: ESP32 ONLINE ─────────────────────────────────────────
function setOnlineUI(data) {
  const wasOffline = !state.esp32Connected;
  state.esp32Connected = true;
  state.lastSuccessTime = Date.now();
 
  // ── Validasi & ambil nilai sensor ──────────────────────────
  const temp     = isValidNumber(data.temp,     -40, 125) ? data.temp     : null;
  const humidity = isValidNumber(data.humidity,   0, 100) ? data.humidity : null;
  const gas      = isValidNumber(data.gas,        0, 9999)? data.gas      : null;
  let   fillPct  = parseInt(data.fillPct);
  if (isNaN(fillPct) || fillPct < 0 || fillPct > 100) fillPct = 0;
 
  state.temp     = temp     ?? 0;
  state.humidity = humidity ?? 0;
  state.gas      = gas      ?? 0;
  state.fillPct  = fillPct;
 
  // ── Live badge → online ─────────────────────────────────────
  const liveBadge = document.querySelector('.live-badge');
  if (liveBadge) {
    liveBadge.style.borderColor = '';
    liveBadge.style.color       = '';
    const dot = liveBadge.querySelector('.live-dot');
    if (dot) dot.style.background = '';
    const textNode = liveBadge.childNodes[1];
    if (textNode) textNode.textContent = ' LIVE';
  }
 
  // ── Status panel — Koneksi Sensor ──────────────────────────
  const sensorChip = document.getElementById('sensorChip');
  const sensorDesc = document.getElementById('sensorDesc');
  if (sensorChip) {
    sensorChip.textContent = 'TERHUBUNG';
    sensorChip.className   = 'status-chip chip-ok';
  }
  if (sensorDesc) {
    sensorDesc.textContent = 'Semua sensor terhubung';
  }
 
  // ── Suhu ───────────────────────────────────────────────────
  if (temp === null) {
    document.getElementById('tempVal').innerHTML =
      `0<span class="card-unit">°C</span>`;
    document.getElementById('tempStatus').textContent =
      '⚠ Sensor suhu error / terputus';
    setCardDotStatus('tempDot', false);
  } else {
    document.getElementById('tempVal').innerHTML =
      `${Math.round(temp)}<span class="card-unit">°C</span>`;
    document.getElementById('tempStatus').textContent =
      temp > 35 ? '⚠ Panas — di atas normal' : '✓ Normal — Kondisi aman';
    setCardDotStatus('tempDot', true);
  }
 
  // ── Kelembapan ─────────────────────────────────────────────
  if (humidity === null) {
    document.getElementById('humVal').innerHTML =
      `0<span class="card-unit">%</span>`;
    document.getElementById('humStatus').textContent =
      '⚠ Sensor kelembapan error / terputus';
    setCardDotStatus('humDot', false);
  } else {
    document.getElementById('humVal').innerHTML =
      `${Math.round(humidity)}<span class="card-unit">%</span>`;
    const humOk = humidity >= 60 && humidity <= 70;
    document.getElementById('humStatus').textContent =
      humOk ? '✓ Optimal — 60–70% ideal'
            : (humidity < 60 ? '⚠ Terlalu kering' : '⚠ Terlalu lembap');
    setCardDotStatus('humDot', true);
  }
 
  // ── Gas ────────────────────────────────────────────────────
  if (gas === null) {
    document.getElementById('gasVal').innerHTML =
      `0<span class="card-unit">ppm</span>`;
    document.getElementById('gasStatus').textContent =
      '⚠ Sensor gas error / terputus';
    setCardDotStatus('gasDot', false);
    const gasChip = document.getElementById('gasChip');
    if (gasChip) { gasChip.textContent = 'ERROR'; gasChip.className = 'status-chip chip-err'; }
  } else {
    document.getElementById('gasVal').innerHTML =
      `${Math.round(gas)}<span class="card-unit">ppm</span>`;
    const gasDanger = gas > 700;
    document.getElementById('gasStatus').textContent =
      gasDanger ? '⚠ Tinggi — perlu ventilasi' : '✓ Normal — Di bawah 1000ppm';
    setCardDotStatus('gasDot', true);
    const gasChip = document.getElementById('gasChip');
    const gasDesc = document.getElementById('gasStatusDesc');
    if (gasChip) {
      gasChip.textContent = gasDanger ? 'BAHAYA' : 'AMAN';
      gasChip.className   = gasDanger ? 'status-chip chip-err' : 'status-chip chip-ok';
    }
    if (gasDesc) {
      gasDesc.textContent = gasDanger
        ? 'Level tinggi · perlu ventilasi'
        : 'Level normal · tidak berbahaya';
    }
  }
 
  // ── Bin Fill ───────────────────────────────────────────────
  updateBinFill(fillPct);
 
  // ── Auto-Press Status ────────────────────────────────────────
  const isPress      = !!data.isPress;
  const pressStage   = (typeof data.pressStage === 'number') ? data.pressStage : 0;
  const autoRunning  = !!data.autoRunning;
  const cooldownSec  = (typeof data.autoCooldownSec === 'number') ? data.autoCooldownSec : 0;
  state.isPress = isPress;

  // Ikon & warna berdasarkan stage
  const STAGE_ICON  = { 0:'⏸️', 1:'⬇️', 2:'⬆️' };
  const STAGE_LABEL = { 0:'STANDBY', 1:'MAJU ⬇️', 2:'MUNDUR ⬆️' };
  const STAGE_SUB   = {
    0: autoRunning ? 'Auto-press: servo sedang bergerak…'
                   : (cooldownSec > 0 ? 'Cooldown setelah press' : 'Menunggu sampah ≥ 85% selama 3 detik'),
    1: '🤖 Auto: aktuator bergerak MAJU — menunggu mentok',
    2: '🤖 Auto: aktuator bergerak MUNDUR',
  };
  const STAGE_COLOR = { 0: cooldownSec > 0 ? '#fbbf24' : 'var(--muted)', 1:'var(--green)', 2:'#60a5fa' };

  const pressLabel = document.getElementById('pressLabel');
  const pressSub   = document.getElementById('pressSub');
  const pressIcon  = document.getElementById('pressIcon');
  const pressRing  = document.getElementById('pressRing');
  if (pressLabel) { pressLabel.textContent = STAGE_LABEL[pressStage] ?? 'STANDBY'; pressLabel.style.color = STAGE_COLOR[pressStage]; }
  if (pressSub)   pressSub.textContent = STAGE_SUB[pressStage] ?? '';
  if (pressIcon)  pressIcon.textContent = STAGE_ICON[pressStage] ?? '⏸️';
  if (pressRing)  pressRing.className   = 'press-ring' + (isPress ? ' active' : '');

  // Fill bar progress (visual fill level vs 85% threshold)
  const autoFillBar = document.getElementById('autoFillBar');
  if (autoFillBar) autoFillBar.style.width = Math.min(fillPct, 100) + '%';

  // Timer label
  const autoTimerLabel = document.getElementById('autoTimerLabel');
  if (autoTimerLabel) {
    if (autoRunning) {
      autoTimerLabel.textContent = pressStage === 1 ? '⬇ Maju — tunggu limit switch…'
                                 : pressStage === 2 ? '⬆ Mundur ke posisi awal…'
                                 : 'Servo bergerak…';
      autoTimerLabel.style.color = '#22d3a5';
    } else if (cooldownSec > 0) {
      autoTimerLabel.textContent = `Cooldown ${cooldownSec}s — akan aktif kembali`;
      autoTimerLabel.style.color = '#fbbf24';
    } else if (fillPct >= 85) {
      autoTimerLabel.textContent = `⚠ ${fillPct}% — menghitung 3 detik…`;
      autoTimerLabel.style.color = '#f97316';
    } else {
      autoTimerLabel.textContent = `${fillPct}% terisi · threshold 85%`;
      autoTimerLabel.style.color = '#6b7280';
    }
  }

  // Cooldown badge
  const cooldownBadge = document.getElementById('cooldownBadge');
  const cooldownSecEl = document.getElementById('cooldownSec');
  if (cooldownBadge) cooldownBadge.style.display = cooldownSec > 0 ? 'block' : 'none';
  if (cooldownSecEl) cooldownSecEl.textContent = cooldownSec + 's';

  // Log event saat ada perubahan stage atau auto mulai/selesai
  if (autoRunning && !_prevAutoRunning) {
    addLog('🤖 Auto-press dimulai — sampah penuh terdeteksi', '#f97316');
  }
  if (!autoRunning && _prevAutoRunning) {
    addLog('✅ Auto-press selesai — sistem kembali standby', '#22d3a5');
  }
  if (pressStage === 1 && _prevPressStage !== 1 && autoRunning) {
    addLog('⬇️ Aktuator MAJU — menunggu limit switch', '#22d3a5');
  }
  if (pressStage === 2 && _prevPressStage !== 2) {
    addLog('⬆️ Aktuator MUNDUR — kembali ke posisi awal', '#60a5fa');
  }
  _prevAutoRunning = autoRunning;
  _prevPressStage  = pressStage;

  setCardDotStatus('pressDot', isPress);
 
  // Bin full chip
  const binFullChip = document.getElementById('binFullChip');
  const binFullDesc = document.getElementById('binFullDesc');
  if (fillPct >= 95) {
    if (binFullChip) { binFullChip.textContent = 'PENUH'; binFullChip.className = 'status-chip chip-err'; }
    if (binFullDesc) binFullDesc.textContent = 'Penuh — segera ambil sampah';
  } else if (fillPct >= 75) {
    if (binFullChip) { binFullChip.textContent = 'HAMPIR PENUH'; binFullChip.className = 'status-chip chip-warn'; }
    if (binFullDesc) binFullDesc.textContent = `Hampir penuh · ${fillPct}% terisi`;
  } else {
    if (binFullChip) { binFullChip.textContent = 'NORMAL'; binFullChip.className = 'status-chip chip-ok'; }
    if (binFullDesc) binFullDesc.textContent = `Kapasitas tersedia · ${fillPct}% terisi`;
  }
 
  // ── History ────────────────────────────────────────────────
  const now = new Date();
  const label =
    now.getHours().toString().padStart(2,'0') + ':' +
    now.getMinutes().toString().padStart(2,'0');
 
  history.labels.push(label);
  history.temp.push(state.temp);
  history.humid.push(state.humidity);
  history.gas.push(state.gas);
 
  if (history.labels.length > 60) {
    history.labels.shift();
    history.temp.shift();
    history.humid.shift();
    history.gas.shift();
  }
 
  sparkTemp.data.datasets[0].data = history.temp.slice(-20);
  sparkHum.data.datasets[0].data  = history.humid.slice(-20);
  sparkGas.data.datasets[0].data  = history.gas.slice(-20);
  sparkTemp.update();
  sparkHum.update();
  sparkGas.update();
 
  mainChart.data.labels = history.labels;
  if (currentTab === 'suhu')  mainChart.data.datasets[0].data = history.temp;
  if (currentTab === 'humid') mainChart.data.datasets[0].data = history.humid;
  if (currentTab === 'gas')   mainChart.data.datasets[0].data = history.gas;
  mainChart.update();
 
  if (wasOffline) {
    addLog('✓ ESP32 terhubung kembali — data diterima', '#22d3a5');
  }
}
 
// ─── Helper: validasi angka ──────────────────────────────────
function isValidNumber(val, min, max) {
  const n = parseFloat(val);
  return !isNaN(n) && n >= min && n <= max;
}
 
// ─── Helper: status dot kartu sensor ─────────────────────────
function setCardDotStatus(id, ok) {
  const dot = document.getElementById(id);
  if (!dot) return;
  if (ok) {
    dot.style.background   = 'var(--green)';
    dot.style.boxShadow    = '0 0 8px var(--green)';
    dot.style.animation    = 'pulse 1.5s infinite';
  } else {
    dot.style.background   = '#ef4444';
    dot.style.boxShadow    = '0 0 8px #ef4444';
    dot.style.animation    = 'pulse 2s infinite';
  }
}
 
// ─── Fetch ESP32 ──────────────────────────────────────────────
async function getESPData() {
  try {
    const controller = new AbortController();
    const timeout    = setTimeout(() => controller.abort(), OFFLINE_TIMEOUT);
 
    const response = await fetch(
      `http://${ESP32_IP}/data`,
      { signal: controller.signal }
    );
    clearTimeout(timeout);
 
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
 
    const data = await response.json();
    window.setOnlineUI(data);
 
  } catch (error) {
    // Jika sudah terlalu lama tidak ada respon → offline
    const timeSinceLast = state.lastSuccessTime
      ? Date.now() - state.lastSuccessTime
      : Infinity;
 
    if (!state.esp32Connected || timeSinceLast > OFFLINE_TIMEOUT) {
      window.setOfflineUI();
    }
 
    console.warn('ESP32 tidak merespons:', error.message);
  }
}
 
// ─── Tambah ID pada dot di HTML (pakai JS karena HTML tidak diubah) ──
function patchDotIds() {
  const cards = document.querySelectorAll('.sensor-card');
  const ids   = ['tempDot', 'humDot', 'gasDot', 'pressDot'];
  cards.forEach((card, i) => {
    const dot = card.querySelector('.card-status-dot');
    if (dot && ids[i]) dot.id = ids[i];
  });
 
  // Status row — Koneksi Sensor: tambah id ke chip & desc
  const rows = document.querySelectorAll('.status-row');
  rows.forEach(row => {
    const name = row.querySelector('.status-name');
    if (!name) return;
    const txt = name.textContent.trim();
    if (txt === 'Koneksi Sensor') {
      const chip = row.querySelector('.status-chip');
      const desc = row.querySelector('.status-desc');
      if (chip && !chip.id) chip.id = 'sensorChip';
      if (desc && !desc.id) desc.id = 'sensorDesc';
    }
  });
}
 
// ─── Init ─────────────────────────────────────────────────────
patchDotIds();
updateBinFill(0);
 
// Langsung set UI offline saat pertama load
window.setOfflineUI();
 
// Mulai polling
getESPData();
setInterval(getESPData, FETCH_INTERVAL);
 
// 3D card tilt
document.querySelectorAll('.sensor-card').forEach(card => {
  card.addEventListener('mousemove', e => {
    const rect = card.getBoundingClientRect();
    const cx = rect.left + rect.width / 2;
    const cy = rect.top  + rect.height / 2;
    const rx = (e.clientY - cy) / (rect.height / 2) * -6;
    const ry = (e.clientX - cx) / (rect.width  / 2) *  6;
    card.style.transform = `translateY(-4px) rotateX(${rx}deg) rotateY(${ry}deg)`;
  });
  card.addEventListener('mouseleave', () => {
    card.style.transform = '';
  });
});
 
// ─── CAMERA CONFIG ────────────────────────────────────────────
const CAM_IP     = "192.168.100.68";   // GANTI dengan IP Camera Anda
const CAM_STREAM = `http://${CAM_IP}/stream`;
 
// ─── Camera State ─────────────────────────────────────────────
const camState = {
  streaming: false,   // apakah stream berhasil load
  enabled:   false    // apakah boleh connect (hanya true saat ESP32 online)
};
 
// ─── Camera UI Helpers ────────────────────────────────────────
function setCamUI_disconnected() {
  // ESP32 offline → kamera langsung tidak terhubung, jangan coba connect
  camState.enabled   = false;
  camState.streaming = false;
 
  stopCamStream();
 
  setEl('camOfflineIcon',    '📷');
  setEl('camOfflineTitle',   'TIDAK TERHUBUNG');
  setEl('camOfflineDesc',    'ESP32 offline — sistem tidak aktif');
  showEl('camOfflineSpinner', false);
  showEl('camOfflineOverlay', true);
  showEl('camActiveOverlay',  false);
  showEl('camStream',         false);
 
  // Stats
  styleEl('camStatObj', '—', '#6b7280');
  styleEl('camStatFps', '—', '#6b7280');
  styleEl('camStatRes', '—', '#6b7280');
 
  // Alert box
  setCamAlert('rgba(239,68,68,0.06)', 'rgba(239,68,68,0.2)', '#ef4444', 'ESP32 tidak terhubung — kamera nonaktif');
 
  // Status panel
  setCamChip('OFFLINE', 'chip-err', 'ESP32 tidak terhubung');
 
  document.getElementById('camSubtitle').textContent = 'Kamera nonaktif · CAM-01';
}
 
function setCamUI_connecting() {
  // ESP32 online, sedang mencoba load stream kamera
  setEl('camOfflineIcon',    '🔄');
  setEl('camOfflineTitle',   'MENGHUBUNGKAN…');
  setEl('camOfflineDesc',    `Mencoba terhubung ke ${CAM_IP}`);
  showEl('camOfflineSpinner', true);
  showEl('camOfflineOverlay', true);
  showEl('camActiveOverlay',  false);
  showEl('camStream',         false);
 
  styleEl('camStatObj', '—', '#6b7280');
  styleEl('camStatFps', 'Connecting', '#fbbf24');
  styleEl('camStatRes', '—', '#6b7280');
 
  setCamAlert('rgba(251,191,36,0.06)', 'rgba(251,191,36,0.2)', '#fbbf24', 'Menghubungkan ke IP Camera…');
  setCamChip('CONNECTING', 'chip-warn', `Menghubungkan ke ${CAM_IP}`);
  document.getElementById('camSubtitle').textContent = 'Menghubungkan · CAM-01';
}
 
function setCamUI_online() {
  // Stream berhasil
  camState.streaming = true;
 
  showEl('camOfflineOverlay', false);
  showEl('camActiveOverlay',  true);
  showEl('camStream',         true);
 
  styleEl('camStatObj', '—',    '#22d3a5');
  styleEl('camStatFps', 'LIVE', '#22d3a5');
  styleEl('camStatRes', 'OK',   '#22d3a5');
 
  setCamAlert('rgba(34,211,165,0.06)', 'rgba(34,211,165,0.15)', '#22d3a5', 'Stream aktif — kamera terhubung');
  setCamChip('ONLINE', 'chip-ok', `Streaming dari ${CAM_IP}`);
  document.getElementById('camSubtitle').textContent = 'Live stream aktif · CAM-01';
 
  addLog('📷 Kamera terhubung — stream aktif', '#22d3a5');
}
 
function setCamUI_error() {
  // ESP32 online tapi kamera tidak bisa diakses
  camState.streaming = false;
 
  stopCamStream();
 
  setEl('camOfflineIcon',    '⚠️');
  setEl('camOfflineTitle',   'KAMERA TIDAK MERESPONS');
  setEl('camOfflineDesc',    `Tidak dapat terhubung ke ${CAM_IP}`);
  showEl('camOfflineSpinner', false);
  showEl('camOfflineOverlay', true);
  showEl('camActiveOverlay',  false);
  showEl('camStream',         false);
 
  styleEl('camStatObj', '—',     '#ef4444');
  styleEl('camStatFps', 'ERROR', '#ef4444');
  styleEl('camStatRes', 'GAGAL', '#ef4444');
 
  setCamAlert('rgba(239,68,68,0.06)', 'rgba(239,68,68,0.2)', '#ef4444', `Kamera tidak merespons — cek koneksi ${CAM_IP}`);
  setCamChip('ERROR', 'chip-err', `Gagal terhubung ke ${CAM_IP}`);
  document.getElementById('camSubtitle').textContent = 'Kamera error · CAM-01';
 
  addLog(`⚠ Kamera tidak merespons (${CAM_IP})`, '#ef4444');
}
 
// ─── Start / Stop stream ──────────────────────────────────────
function startCamStream() {
  const img = document.getElementById('camStream');
 
  setCamUI_connecting();
 
  // Buat URL unik tiap kali koneksi untuk cegah browser caching
  const url = CAM_STREAM + '?t=' + Date.now();
  img.src   = '';   // reset dulu
 
  img.onload  = () => { setCamUI_online(); };
  img.onerror = () => { setCamUI_error();  scheduleCamRetry(); };
 
  img.src = url;
}
 
function stopCamStream() {
  const img  = document.getElementById('camStream');
  img.onload = null;
  img.onerror = null;
  img.src    = '';
}
 
// ─── Retry kamera bila error (setiap 10 detik) ────────────────
let camRetryTimer = null;
function scheduleCamRetry() {
  if (camRetryTimer) return;
  camRetryTimer = setTimeout(() => {
    camRetryTimer = null;
    if (camState.enabled) startCamStream();
  }, 10000);
}
 
// ─── Dipanggil dari setOnlineUI / setOfflineUI ────────────────
function updateCameraOnESP32Online() {
  if (camState.enabled) return;   // sudah aktif, jangan restart
  camState.enabled = true;
  if (!camState.streaming) startCamStream();
}
 
function updateCameraOnESP32Offline() {
  camState.enabled = false;
  if (camRetryTimer) { clearTimeout(camRetryTimer); camRetryTimer = null; }
  setCamUI_disconnected();
}
 
// ─── DOM util ────────────────────────────────────────────────
function setEl(id, text)            { const e = document.getElementById(id); if(e) e.textContent = text; }
function showEl(id, show)           { const e = document.getElementById(id); if(e) e.style.display = show ? '' : 'none'; }
function styleEl(id, text, color)   { const e = document.getElementById(id); if(e){ e.textContent = text; e.style.color = color; } }
function setCamAlert(bg, border, dotColor, text) {
  const box  = document.getElementById('camAlertBox');
  const dot  = document.getElementById('camAlertDot');
  const txt  = document.getElementById('camAlertText');
  if(box)  { box.style.background = bg; box.style.border = `1px solid ${border}`; }
  if(dot)  { dot.style.background = dotColor; dot.style.boxShadow = `0 0 6px ${dotColor}`; }
  if(txt)  txt.textContent = text;
}
function setCamChip(text, cls, desc) {
  const chip = document.getElementById('camStatusChip');
  const d    = document.getElementById('camStatusDesc');
  if(chip) { chip.textContent = text; chip.className = 'status-chip ' + cls; }
  if(d)    d.textContent = desc;
}
 
// ─── Hook ke setOnlineUI & setOfflineUI ───────────────────────
// Simpan referensi fungsi asli dan wrap
const _origOnline  = setOnlineUI;
const _origOffline = setOfflineUI;
 
// Patch: setelah setOnlineUI dipanggil, aktifkan kamera
window.setOnlineUI = function(data) {
  _origOnline(data);
  updateCameraOnESP32Online();
};
 
window.setOfflineUI = function() {
  _origOffline();
  updateCameraOnESP32Offline();
};
 
// Init camera state
setCamUI_disconnected();
 