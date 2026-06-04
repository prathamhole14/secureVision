/**
 * Renderer process — runs in the sandboxed browser environment.
 * Communicates to Electron Main ONLY via window.electronAPI (set by preload.ts).
 * Uses Socket.IO for real-time connection to backend.
 */

// Type declaration (matches preload.ts)
// window.electronAPI is automatically injected by preload.ts

// === State ===
let state = {
  token: null,
  user: null,
  session: null,
  examConfig: null,
  answers: {},
  currentQuestion: 0,
  timerInterval: null,
  remainingSeconds: 0,
  telemetryQueue: [],
  socketConnected: false,
  examStarted: false,
};
let socket = null;

// === Utils ===
function showView(id) {
  document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
  document.getElementById(id).classList.add('active');
}

function showAlert(msg, type = 'warn') {
  const el = document.getElementById('exam-alert');
  el.textContent = msg;
  el.className = `exam-alert ${type}`;
  el.classList.remove('hidden');
  setTimeout(() => el.classList.add('hidden'), 5000);
}

function formatTime(secs) {
  const m = String(Math.floor(secs / 60)).padStart(2, '0');
  const s = String(secs % 60).padStart(2, '0');
  return `${m}:${s}`;
}

// === IPC Setup (Daemon Events) ===
window.electronAPI.onDaemonStatus(({ connected }) => {
  const dot = document.getElementById('daemon-dot');
  if (!dot) return;
  dot.className = `daemon-dot ${connected ? 'connected' : 'disconnected'}`;
  dot.title = connected ? 'Security daemon connected' : 'Security daemon disconnected';
});

window.electronAPI.onDaemonEvent((event) => {
  console.log('[Daemon Event]', event);
  queueTelemetry(event);

  if (event.severity === 'HIGH') {
    if (event.type === 'screen_capture_attempt') {
      showAlert('⚠️ Screen capture detected! This incident has been logged.', 'error');
      applyPolicy('HIGH');
    } else if (event.type === 'remote_session_detected') {
      showAlert('🚨 Remote session detected! Exam will be terminated.', 'error');
      applyPolicy('HIGH');
    } else if (event.type === 'daemon_tamper') {
      lockdown('Security daemon has been tampered with.');
    }
  } else if (event.severity === 'MEDIUM') {
    showAlert(`⚠️ Security alert: ${event.type.replace(/_/g, ' ')}`, 'warn');
    applyPolicy('MEDIUM');
  }
});

function handleServerCommand(cmd) {
  console.log('[Server Command]', cmd);
  if (cmd.command === 'FORCE_SUBMIT') {
    submitExam('Forced submission by professor');
  } else if (cmd.command === 'WARN') {
    showAlert('⚠️ Warning from professor: Please comply with exam rules.', 'warn');
    queueTelemetry({ type: 'server_warn_received', severity: 'LOW', timestamp: new Date().toISOString(), payload: {} });
  } else if (cmd.command === 'LOCK') {
    lockdown('Exam locked by professor.');
  } else if (cmd.command === 'BROADCAST') {
    showBroadcastMessage(cmd.message || 'No message content');
    queueTelemetry({ type: 'broadcast_received', severity: 'LOW', timestamp: new Date().toISOString(), payload: { message: cmd.message } });
  }
}

window.electronAPI.onServerCommand((cmd) => {
  handleServerCommand(cmd);
});

function showBroadcastMessage(msg) {
  const toast = document.createElement('div');
  toast.style = 'position:fixed;top:40px;left:50%;transform:translateX(-50%);background:rgba(26,26,26,0.95);border:1px solid rgba(255,255,255,0.12);backdrop-filter:blur(10px);padding:18px 30px;border-radius:12px;box-shadow:0 12px 40px rgba(0,0,0,0.8);z-index:999999;display:flex;align-items:center;gap:16px;animation:slideDown 0.35s cubic-bezier(0.16, 1, 0.3, 1);color:#fff;max-width:550px;min-width:320px;';
  toast.innerHTML = `
    <div style="font-size:2rem;filter:drop-shadow(0 0 10px rgba(255,255,255,0.2))">📢</div>
    <div>
      <div style="font-size:0.7rem;text-transform:uppercase;letter-spacing:0.08em;color:var(--muted,#9a9a9a);font-weight:700;">Broadcast from Proctor</div>
      <div style="font-size:1.05rem;font-weight:600;margin-top:4px;line-height:1.4;">${msg}</div>
    </div>
  `;
  document.body.appendChild(toast);
  
  if (!document.getElementById('broadcast-style-tag')) {
    const style = document.createElement('style');
    style.id = 'broadcast-style-tag';
    style.innerHTML = `
      @keyframes slideDown {
        from { transform: translate(-50%, -60px); opacity: 0; }
        to { transform: translate(-50%, 0); opacity: 1; }
      }
    `;
    document.head.appendChild(style);
  }
  
  setTimeout(() => {
    toast.style.transition = 'all 0.5s cubic-bezier(0.16, 1, 0.3, 1)';
    toast.style.opacity = '0';
    toast.style.transform = 'translate(-50%, -20px)';
    setTimeout(() => toast.remove(), 600);
  }, 9000);
}

// === Soft Sensors (JS level) ===
window.addEventListener('blur', () => {
  window.electronAPI.reportFocusEvent('blur');
  // focus_loss event is natively captured by Electron Main and the Daemon to prevent triplicated flags
  showAlert('Please return to the exam window!', 'warn');
});

window.addEventListener('focus', () => {
  window.electronAPI.reportFocusEvent('focus');
});

document.addEventListener('visibilitychange', () => {
  if (document.hidden) {
    queueTelemetry({ type: 'tab_hidden', severity: 'LOW', timestamp: new Date().toISOString(), payload: {} });
  }
});

document.addEventListener('keydown', (e) => {
  if (!state.examStarted) return;
  if (state.paused) {
    e.preventDefault();
    return;
  }
  // Intercept common cheating shortcuts
  const blocked = [
    e.metaKey && e.key === 'c', // Cmd+C (copy)
    e.ctrlKey && e.key === 'c',
    e.metaKey && e.key === 'v',
    e.ctrlKey && e.key === 'v',
    e.key === 'PrintScreen',
    e.altKey && e.key === 'Tab',
  ];
  if (blocked.some(Boolean)) {
    e.preventDefault();
    queueTelemetry({ type: 'shortcut_blocked', severity: 'LOW', timestamp: new Date().toISOString(), payload: { key: e.key, ctrl: e.ctrlKey, meta: e.metaKey } });
  }
});

document.addEventListener('contextmenu', (e) => {
  if (state.examStarted) e.preventDefault();
});
document.addEventListener('copy', (e) => {
  if (state.examStarted) e.preventDefault();
});
document.addEventListener('paste', (e) => {
  if (state.examStarted) e.preventDefault();
});

// === Policy Enforcement ===
function applyPolicy(severity) {
  const policy = state.examConfig?.policy || {};
  if (severity === 'HIGH') {
    const action = policy.highSeverityAction || 'submit';
    if (action === 'submit') submitExam('High-severity violation');
    else if (action === 'lock') lockdown('Security violation detected.');
  } else if (severity === 'MEDIUM') {
    // Completely map pause/warn actions to standard warnings to avoid overlays
    showAlert('⚠️ Security Alert: Please comply with the exam rules!', 'warn');
  }
}

function lockdown(reason) {
  document.getElementById('lockdown-reason').textContent = reason;
  document.getElementById('lockdown-session-id').textContent = state.session?.id || '';
  showView('view-lockdown');
  clearInterval(state.timerInterval);
  stopWebcamProctoring();
  stopMicProctoring();
  window.electronAPI.stopProtection?.();
}

// === Telemetry ===
function queueTelemetry(event) {
  if (!state.session) return;
  state.telemetryQueue.push({ ...event, timestamp: event.timestamp || new Date().toISOString() });
}

async function flushTelemetry() {
  if (!state.session || state.telemetryQueue.length === 0) return;
  const batch = state.telemetryQueue.splice(0, 50);
  try {
    const backendUrlVar = await window.electronAPI.getBackendUrl();
    await fetch(`${backendUrlVar}/api/telemetry/batch`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${state.token}`,
      },
      body: JSON.stringify({ sessionId: state.session.id, events: batch }),
    });
  } catch { state.telemetryQueue.unshift(...batch); }
}
setInterval(flushTelemetry, 5000);

// === Socket.IO ===
function connectSocket(backendUrl) {
  // Dynamically load socket.io-client from CDN (Electron packager will bundle this)
  const script = document.createElement('script');
  // Backend configures Socket.IO with path: '/ws'
  script.src = `${backendUrl}/ws/socket.io.js`;
  script.onload = () => initSocket(backendUrl);
  script.onerror = () => console.error('Failed to load socket.io.js from backend');
  document.head.appendChild(script);
}

function initSocket(backendUrl) {
  if (socket) {
    try { socket.disconnect(); } catch (e) {}
  }
  socket = io(`${backendUrl}/exam`, {
    path: '/ws',
    auth: { token: state.token },
  });

  socket.on('connect', () => { state.socketConnected = true; });
  socket.on('disconnect', () => { state.socketConnected = false; });
  socket.on('session:started', () => {});
  socket.on('server:command', (cmd) => handleServerCommand(cmd));
}

function emitSocketEvent(event) {
  if (socket && state.socketConnected && state.session) {
    socket.emit('student:telemetry', {
      sessionId: state.session.id,
      type: event.type,
      payload: event.payload || {},
      severity: event.severity || 'LOW',
    });
  }
}

let webcamStream = null;
let webcamInterval = null;

async function startWebcamProctoring() {
  try {
    let video = document.getElementById('student-webcam-preview');
    if (!video) {
      video = document.createElement('video');
      video.autoplay = true;
      video.playsInline = true;
      video.muted = true;
      video.style.display = 'none';
      document.body.appendChild(video);
    }

    const canvas = document.createElement('canvas');
    canvas.width = 160;
    canvas.height = 120;
    canvas.style.display = 'none';
    document.body.appendChild(canvas);

    webcamStream = await navigator.mediaDevices.getUserMedia({
      video: { width: 160, height: 120 }
    });
    video.srcObject = webcamStream;

    // Send a frame every 10 seconds
    webcamInterval = setInterval(() => {
      if (socket && state.socketConnected && state.session) {
        const ctx = canvas.getContext('2d');
        if (ctx && video.readyState === video.HAVE_ENOUGH_DATA) {
          ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
          const dataUrl = canvas.toDataURL('image/jpeg', 0.5);
          socket.emit('student:webcam', {
            sessionId: state.session.id,
            image: dataUrl,
          });
        }
      }
    }, 10000);

    console.log('[Webcam] Proctoring camera stream initiated and bound to self preview.');
  } catch (err) {
    console.error('[Webcam] Failed to access webcam:', err);
    queueTelemetry({
      type: 'webcam_error',
      severity: 'MEDIUM',
      timestamp: new Date().toISOString(),
      payload: { error: err.message }
    });
  }
}

function stopWebcamProctoring() {
  if (webcamInterval) {
    clearInterval(webcamInterval);
    webcamInterval = null;
  }
  const video = document.getElementById('student-webcam-preview');
  if (video) {
    video.srcObject = null;
  }
  if (webcamStream) {
    webcamStream.getTracks().forEach(track => track.stop());
    webcamStream = null;
  }
  console.log('[Webcam] Stream stopped.');
}

let audioStream = null;
let audioContext = null;
let audioAnalyser = null;
let micLevelInterval = null;

async function startMicProctoring() {
  try {
    audioStream = await navigator.mediaDevices.getUserMedia({ audio: true });
    
    const AudioContextClass = window.AudioContext || window.webkitAudioContext;
    audioContext = new AudioContextClass();
    const source = audioContext.createMediaStreamSource(audioStream);
    audioAnalyser = audioContext.createAnalyser();
    audioAnalyser.fftSize = 64;
    source.connect(audioAnalyser);
    
    const bufferLength = audioAnalyser.frequencyBinCount;
    const dataArray = new Uint8Array(bufferLength);
    
    micLevelInterval = setInterval(() => {
      if (audioAnalyser && socket && state.socketConnected && state.session) {
        audioAnalyser.getByteFrequencyData(dataArray);
        let sum = 0;
        for (let i = 0; i < bufferLength; i++) {
          sum += dataArray[i];
        }
        const average = sum / bufferLength;
        const volumeLevel = Math.round((average / 255) * 100);
        
        socket.emit('student:mic-level', {
          sessionId: state.session.id,
          volume: volumeLevel
        });
        
        if (volumeLevel > 35) {
          queueTelemetry({
            type: 'high_noise_detected',
            severity: 'LOW',
            timestamp: new Date().toISOString(),
            payload: { volume: volumeLevel }
          });
        }
      }
    }, 3000);
    
    console.log('[Mic] Proctoring microphone stream initiated.');
  } catch (err) {
    console.warn('[Mic] Failed to access microphone:', err.message);
  }
}

function stopMicProctoring() {
  if (micLevelInterval) {
    clearInterval(micLevelInterval);
    micLevelInterval = null;
  }
  if (audioContext) {
    try { audioContext.close(); } catch (e) {}
    audioContext = null;
  }
  if (audioStream) {
    audioStream.getTracks().forEach(track => track.stop());
    audioStream = null;
  }
  console.log('[Mic] Stream stopped.');
}

// === Auth ===
let backendUrl = 'http://localhost:3001';
window.electronAPI.getBackendUrl().then(url => {
  backendUrl = url;
  connectSocket(url);
});

document.getElementById('btn-verify-code').addEventListener('click', async () => {
  const codeInput = document.getElementById('inp-access-code');
  const code = codeInput ? codeInput.value.trim().toUpperCase() : '';
  const errorEl = document.getElementById('login-error');

  if (!code) {
    if (errorEl) {
      errorEl.textContent = 'Please enter an access code';
      errorEl.classList.remove('hidden');
    }
    return;
  }

  console.log('Verifying exam access code:', code, 'with backend:', backendUrl);
  try {
    const res = await fetch(`${backendUrl}/api/sessions/validate-code`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ entryCode: code }),
    });

    console.log('Verification response status:', res.status);
    if (!res.ok) {
      const err = await res.json();
      console.error('Verification failed:', err);
      if (errorEl) {
        errorEl.textContent = err.error || 'Invalid or expired access key';
        errorEl.className = 'alert alert-error';
        errorEl.classList.remove('hidden');
      }
      return;
    }

    const data = await res.json();
    console.log('Exam verified! Starting session:', data.sessionId);
    
    // Save state
    state.token = data.token;
    state.user = data.user;
    state.session = { id: data.sessionId, token: data.sessionToken };
    state.examConfig = data.examConfig;
    state.remainingSeconds = (data.duration || 90) * 60;
    state.answers = {};
    state.currentQuestion = 0;
    state.examStarted = true;

    // Start native daemon proctoring
    window.electronAPI.startProtection(data.sessionToken);

    // Auto-Fullscreen (Try both HTML5 API and Electron IPC)
    try {
      document.documentElement.requestFullscreen?.();
    } catch (err) {
      console.warn('HTML5 requestFullscreen failed:', err);
    }
    window.electronAPI.requestFullscreen?.();

    // Dynamically connect Socket.IO and join session
    connectSocket(backendUrl);

    // Give socket a tiny moment to connect before joining
    setTimeout(() => {
      socket?.emit('student:join', { sessionId: data.sessionId });
    }, 800);

    // Render exam page
    document.getElementById('exam-title-header').textContent = 'Exam in Progress';
    showView('view-exam');
    renderExam();
    startTimer();
    startWebcamProctoring();
    startMicProctoring();

  } catch (err) {
    console.error('CRITICAL CODE VERIFICATION EXCEPTION:', err);
    if (errorEl) {
      errorEl.textContent = 'Connection error: ' + err.message;
      errorEl.className = 'alert alert-error';
      errorEl.classList.remove('hidden');
    }
  }
});

document.getElementById('btn-logout').addEventListener('click', () => {
  state.token = null; state.user = null;
  showView('view-login');
});

// === Exams List ===
async function loadExams() {
  const res = await fetch(`${backendUrl}/api/exams`, { headers: { Authorization: `Bearer ${state.token}` } });
  const data = await res.json();
  const container = document.getElementById('exams-list');
  if (!data.exams?.length) {
    container.innerHTML = '<p style="color:#7e8fba">No active exams available.</p>';
    return;
  }
  container.innerHTML = data.exams.map(e => `
    <div class="exam-card" data-id="${e.id}">
      <div>
        <div class="exam-card-title">${e.title}</div>
        <div class="exam-card-meta">Duration: ${e.duration} minutes</div>
      </div>
      <button class="btn btn-primary btn-sm">Start Exam →</button>
    </div>
  `).join('');
  container.querySelectorAll('.exam-card').forEach(card => {
    card.addEventListener('click', () => startExam(card.dataset.id));
  });
}

// === Exam ===
async function startExam(examId) {
  const res = await fetch(`${backendUrl}/api/exams/${examId}/start`, {
    method: 'POST', headers: { Authorization: `Bearer ${state.token}` },
  });
  if (!res.ok) { alert('Could not start exam'); return; }
  const data = await res.json();
  state.session = { id: data.sessionId, token: data.sessionToken };
  state.examConfig = data.examConfig;
  state.remainingSeconds = (data.duration || 90) * 60;
  state.answers = {};
  state.currentQuestion = 0;
  state.examStarted = true;

  // Start daemon protection
  window.electronAPI.startProtection(data.sessionToken);

  // Auto-Fullscreen (Try both HTML5 API and Electron IPC)
  try {
    document.documentElement.requestFullscreen?.();
  } catch (err) {
    console.warn('HTML5 requestFullscreen failed:', err);
  }
  window.electronAPI.requestFullscreen?.();

  // Join socket room
  socket?.emit('student:join', { sessionId: data.sessionId });

  document.getElementById('exam-title-header').textContent = 'Exam in Progress';
  showView('view-exam');
  renderExam();
  startTimer();
}

function renderExam() {
  const questions = state.examConfig?.questions || [];

  // Nav buttons
  const nav = document.getElementById('q-nav-buttons');
  nav.innerHTML = questions.map((q, i) => `
    <button class="q-nav-btn ${i === state.currentQuestion ? 'active' : ''} ${state.answers[q.id] !== undefined ? 'answered' : ''}"
      data-q="${i}">Q${i + 1}</button>
  `).join('');
  nav.querySelectorAll('.q-nav-btn').forEach(btn => {
    btn.addEventListener('click', () => { state.currentQuestion = parseInt(btn.dataset.q); renderExam(); });
  });

  // Progress
  const answered = Object.keys(state.answers).length;
  document.getElementById('progress-bar').style.width = `${(answered / Math.max(questions.length, 1)) * 100}%`;

  // Current question
  const q = questions[state.currentQuestion];
  if (!q) return;
  const area = document.getElementById('question-display');
  area.innerHTML = `
    <div class="question-num">Question ${state.currentQuestion + 1} of ${questions.length} · ${q.points ?? 0} pts</div>
    <div class="question-text">${q.text}</div>
    ${q.type === 'multiple_choice'
      ? `<div class="option-list">
          ${q.options.map((opt, oi) => `
            <div class="option-item ${state.answers[q.id] === oi ? 'selected' : ''}" data-q="${q.id}" data-i="${oi}">
              <div class="option-radio"></div><span>${opt}</span>
            </div>`).join('')}
        </div>`
      : `<textarea class="short-answer" id="short-ans" placeholder="Type your answer here…">${state.answers[q.id] ?? ''}</textarea>`
    }
    <div class="q-nav-btns">
      ${state.currentQuestion > 0 ? '<button id="btn-prev" class="btn btn-ghost btn-sm">← Prev</button>' : ''}
      ${state.currentQuestion < questions.length - 1
        ? '<button id="btn-next" class="btn btn-primary btn-sm">Next →</button>'
        : '<button id="btn-submit-q" class="btn btn-danger btn-sm">Submit Exam</button>'}
    </div>
  `;

  area.querySelectorAll('.option-item').forEach(item => {
    item.addEventListener('click', () => {
      state.answers[item.dataset.q] = parseInt(item.dataset.i);
      renderExam();
    });
  });
  document.getElementById('short-ans')?.addEventListener('input', (e) => {
    state.answers[q.id] = e.target.value;
  });
  document.getElementById('btn-next')?.addEventListener('click', () => { state.currentQuestion++; renderExam(); });
  document.getElementById('btn-prev')?.addEventListener('click', () => { state.currentQuestion--; renderExam(); });
  document.getElementById('btn-submit-q')?.addEventListener('click', () => submitExam('Student submitted'));
}

function startTimer() {
  clearInterval(state.timerInterval);
  state.timerInterval = setInterval(() => {
    if (state.paused) return; // Freeze timer!
    state.remainingSeconds--;
    const el = document.getElementById('timer');
    if (el) {
      el.textContent = formatTime(state.remainingSeconds);
      el.className = `timer${state.remainingSeconds < 300 ? ' critical' : state.remainingSeconds < 600 ? ' warning' : ''}`;
    }
    if (state.remainingSeconds <= 0) { clearInterval(state.timerInterval); submitExam('Time expired'); }
  }, 1000);
}

async function submitExam(reason) {
  clearInterval(state.timerInterval);
  stopWebcamProctoring();
  stopMicProctoring();
  flushTelemetry();
  window.electronAPI.stopProtection();
  await fetch(`${backendUrl}/api/sessions/${state.session.id}/status`, {
    method: 'PATCH', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${state.token}` },
    body: JSON.stringify({ status: 'COMPLETED', answers: state.answers }),
  });
  document.getElementById('submission-details').textContent =
    `Session ID: ${state.session.id} · Reason: ${reason}`;
  showView('view-submitted');
}

document.getElementById('btn-submit-exam').addEventListener('click', () => {
  if (confirm('Are you sure you want to submit? This cannot be undone.')) submitExam('Student early submission');
});

// === Exit App ===
const exitBtn = document.getElementById('btn-exit-app');
if (exitBtn) {
  exitBtn.addEventListener('click', () => {
    console.log('Exit button clicked');
    if (window.electronAPI && window.electronAPI.closeApp) {
      window.electronAPI.closeApp();
    } else {
      console.error('electronAPI.closeApp not found');
    }
  });
}

const exitLockdownBtn = document.getElementById('btn-exit-app-lockdown');
if (exitLockdownBtn) {
  exitLockdownBtn.addEventListener('click', () => {
    console.log('Exit lockdown button clicked');
    if (window.electronAPI && window.electronAPI.closeApp) {
      window.electronAPI.closeApp();
    } else {
      console.error('electronAPI.closeApp not found');
    }
  });
}

const exitLoginBtn = document.getElementById('btn-exit-login');
if (exitLoginBtn) {
  exitLoginBtn.addEventListener('click', () => {
    console.log('Exit login button clicked');
    if (window.electronAPI && window.electronAPI.closeApp) {
      window.electronAPI.closeApp();
    } else {
      console.error('electronAPI.closeApp not found');
    }
  });
}

