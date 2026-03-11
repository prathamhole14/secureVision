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

window.electronAPI.onServerCommand((cmd) => {
  console.log('[Server Command]', cmd);
  if (cmd.command === 'FORCE_SUBMIT') {
    submitExam('Forced submission by professor');
  } else if (cmd.command === 'WARN') {
    showAlert('⚠️ Warning from professor: Please comply with exam rules.', 'warn');
    queueTelemetry({ type: 'server_warn_received', severity: 'LOW', timestamp: new Date().toISOString(), payload: {} });
  } else if (cmd.command === 'LOCK') {
    lockdown('Exam locked by professor.');
  }
});

// === Soft Sensors (JS level) ===
window.addEventListener('blur', () => {
  window.electronAPI.reportFocusEvent('blur');
  queueTelemetry({ type: 'focus_loss', severity: 'LOW', timestamp: new Date().toISOString(), payload: {} });
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

document.addEventListener('contextmenu', (e) => e.preventDefault());
document.addEventListener('copy', (e) => e.preventDefault());
document.addEventListener('paste', (e) => e.preventDefault());

// === Policy Enforcement ===
function applyPolicy(severity) {
  const policy = state.examConfig?.policy || {};
  if (severity === 'HIGH') {
    const action = policy.highSeverityAction || 'submit';
    if (action === 'submit') submitExam('High-severity violation');
    else if (action === 'lock') lockdown('Security violation detected.');
  } else if (severity === 'MEDIUM') {
    const action = policy.mediumSeverityAction || 'warn';
    if (action === 'pause') showAlert('Exam paused — contact your proctor to continue.', 'error');
  }
}

function lockdown(reason) {
  document.getElementById('lockdown-reason').textContent = reason;
  document.getElementById('lockdown-session-id').textContent = state.session?.id || '';
  showView('view-lockdown');
  clearInterval(state.timerInterval);
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
  socket = io(`${backendUrl}/exam`, {
    path: '/ws',
    auth: { token: state.token },
  });

  socket.on('connect', () => { state.socketConnected = true; });
  socket.on('disconnect', () => { state.socketConnected = false; });
  socket.on('session:started', () => {});
  socket.on('server:command', (cmd) => window.electronAPI.onServerCommand(cmd));
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

// === Auth ===
let backendUrl = 'http://localhost:3001';
window.electronAPI.getBackendUrl().then(url => {
  backendUrl = url;
  connectSocket(url);
});

document.getElementById('btn-google-login').addEventListener('click', async () => {
  console.log('Login button clicked. Attempting to fetch from:', backendUrl);
  try {
    const res = await fetch(`${backendUrl}/api/auth/google`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id_token: 'demo-student-token' }),
    });
    console.log('Fetch response status:', res.status);
    if (!res.ok) {
      const err = await res.json();
      console.error('Login error parsed:', err);
      document.getElementById('login-error').textContent = err.error || 'Login failed';
      document.getElementById('login-error').className = 'alert alert-error';
      return;
    }
    const data = await res.json();
    console.log('Successful login data size:', Object.keys(data));
    state.token = data.token;
    state.user = data.user;
    document.getElementById('user-name').textContent = data.user.name;
    showView('view-exams');
    loadExams();
  } catch (err) {
    console.error('CRITICAL LOGIN EXCEPTION:', err);
    document.getElementById('login-error').textContent = 'Network error: ' + err.message;
    document.getElementById('login-error').className = 'alert alert-error';
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

  // Start daemon protection
  window.electronAPI.startProtection(data.sessionToken);

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
  flushTelemetry();
  window.electronAPI.stopProtection();
  await fetch(`${backendUrl}/api/sessions/${state.session.id}/status`, {
    method: 'PATCH', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${state.token}` },
    body: JSON.stringify({ status: 'COMPLETED' }),
  });
  document.getElementById('submission-details').textContent =
    `Session ID: ${state.session.id} · Reason: ${reason}`;
  showView('view-submitted');
}

document.getElementById('btn-submit-exam').addEventListener('click', () => {
  if (confirm('Are you sure you want to submit? This cannot be undone.')) submitExam('Student early submission');
});
