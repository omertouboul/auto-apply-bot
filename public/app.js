// AutoResume Auto-Apply Frontend Application Logic

// Application State
let appState = {
    cvUploaded: false,
    cvFilename: '',
    settings: {
        keywords: [],
        location: '',
        matchThreshold: 75,
        intervalHours: 4,
        dryRun: true,
        geminiKey: '',
        smtpHost: '',
        smtpPort: 465,
        smtpUser: '',
        smtpPass: '',
        senderName: '',
        smtpSecure: 'true',
        candidatePhone: '',
        candidateLinkedin: ''
    },
    history: [],
    isRunning: false,
    sseSource: null
};

// Initialize App
document.addEventListener('DOMContentLoaded', () => {
    fetchInitialConfig();
    setupNavigation();
    setupFileUpload();
    setupConfigHandlers();
    setupAgentControllers();
    setupThresholdSlider();
    setupTagsInput();
});

// Fetch configuration and logs from Express backend
async function fetchInitialConfig() {
    try {
        const res = await fetch('/api/config');
        const data = await res.json();
        
        appState.cvUploaded = data.cvUploaded;
        appState.cvFilename = data.cvFilename;
        appState.settings = { ...appState.settings, ...data.settings };
        appState.history = data.history || [];
        
        populateInputs();
        updateCVUploadUI();
        updateOverviewBox();
        renderHistoryTable();
        updateStats();

        // Check if agent is currently running
        connectSSEListener();
    } catch (e) {
        console.error('Error fetching initial config:', e);
        showToast('שגיאה בחיבור לשרת.', 'error');
    }
}

// Populate config inputs from state
function populateInputs() {
    const s = appState.settings;
    
    // Agent Configs
    document.getElementById('gemini-key').value = s.geminiKey || '';
    document.getElementById('agent-keywords').value = s.keywords ? s.keywords.join(',') : '';
    if (typeof renderTags === 'function') renderTags();
    document.getElementById('agent-location').value = s.location || 'Israel';
    document.getElementById('agent-interval').value = s.intervalHours || 4;
    document.getElementById('match-threshold').value = s.matchThreshold || 75;
    document.getElementById('threshold-val').textContent = `${s.matchThreshold || 75}%`;
    document.getElementById('dry-run-mode').checked = s.dryRun !== false;
    document.getElementById('continuous-mode').checked = s.continuousMode !== false;
    document.getElementById('candidate-phone').value = s.candidatePhone || '';
    document.getElementById('candidate-linkedin').value = s.candidateLinkedin || '';

    // SMTP Configs
    document.getElementById('sender-name').value = s.senderName || '';
    document.getElementById('smtp-host').value = s.smtpHost || 'smtp.gmail.com';
    document.getElementById('smtp-port').value = s.smtpPort || 465;
    document.getElementById('smtp-secure').value = s.smtpSecure || 'true';
    document.getElementById('smtp-user').value = s.smtpUser || '';
    document.getElementById('smtp-pass').value = s.smtpPass || '';
}

// Dynamic dashboard overview box
function updateOverviewBox() {
    const s = appState.settings;
    document.getElementById('overview-keywords').textContent = s.keywords && s.keywords.length ? s.keywords.join(', ') : 'לא מוגדר';
    document.getElementById('overview-location').textContent = s.location || 'לא מוגדר';
    document.getElementById('overview-threshold').textContent = `${s.matchThreshold || 75}%`;
    const modeLabel = (s.dryRun !== false ? 'מצב בדיקה' : 'מצב שליחה');
    const intervalLabel = (s.continuousMode !== false ? 'ללא הפסקה (45ש\')' : `כל ${s.intervalHours || 4} שעות`);
    document.getElementById('overview-dryrun').textContent = `${modeLabel} | ${intervalLabel}`;
    document.getElementById('overview-dryrun').style.color = s.dryRun !== false ? 'var(--secondary)' : 'var(--warning)';
}

// Updates CV state widgets
function updateCVUploadUI() {
    const dropzone = document.getElementById('cv-dropzone');
    const infoBox = document.getElementById('cv-info-box');
    const filenameEl = document.getElementById('cv-filename');
    
    if (appState.cvUploaded) {
        dropzone.classList.add('hidden');
        infoBox.classList.remove('hidden');
        filenameEl.textContent = appState.cvFilename;
    } else {
        dropzone.classList.remove('hidden');
        infoBox.classList.add('hidden');
    }
}

// Simple Toast Notification System
function showToast(message, type = 'success') {
    const container = document.getElementById('toast-container');
    const toast = document.createElement('div');
    toast.className = `toast ${type}`;
    
    let icon = 'fa-circle-info';
    if (type === 'success') icon = 'fa-circle-check';
    if (type === 'error') icon = 'fa-triangle-exclamation';
    if (type === 'warning') icon = 'fa-circle-exclamation';

    toast.innerHTML = `
        <i class="fa-solid ${icon}"></i>
        <span>${message}</span>
    `;
    
    container.appendChild(toast);
    
    setTimeout(() => {
        toast.style.opacity = '0';
        toast.style.transform = 'translateX(-100%)';
        toast.style.transition = 'all 0.3s ease';
        setTimeout(() => toast.remove(), 300);
    }, 4000);
}

// Log messages inside Terminal Log Console
function logToConsole(message, type = 'plain') {
    const consoleEl = document.getElementById('log-console');
    const time = new Date().toLocaleTimeString();
    const line = document.createElement('div');
    line.className = `log-line ${type}`;
    line.textContent = `[${time}] ${message}`;
    consoleEl.appendChild(line);
    consoleEl.scrollTop = consoleEl.scrollHeight;
}

// Slider helper
function setupThresholdSlider() {
    const slider = document.getElementById('match-threshold');
    const valSpan = document.getElementById('threshold-val');
    slider.addEventListener('input', () => {
        valSpan.textContent = `${slider.value}%`;
    });
}

// Navigation setup
function setupNavigation() {
    const sections = document.querySelectorAll('.view-section');
    const navItems = document.querySelectorAll('.nav-item');
    const pageTitle = document.getElementById('page-title');

    navItems.forEach(item => {
        item.addEventListener('click', (e) => {
            e.preventDefault();
            const targetId = item.getAttribute('href').substring(1);
            
            navItems.forEach(nav => nav.classList.remove('active'));
            item.classList.add('active');
            
            sections.forEach(section => {
                section.classList.remove('active-view');
                if (section.id === `${targetId}-view`) {
                    section.classList.add('active-view');
                }
            });

            pageTitle.textContent = item.querySelector('span').textContent;
        });
    });
}

// CV PDF File Uploader
function setupFileUpload() {
    const dropzone = document.getElementById('cv-dropzone');
    const fileInput = document.getElementById('cv-file-input');
    const infoBox = document.getElementById('cv-info-box');
    const filenameEl = document.getElementById('cv-filename');
    const deleteBtn = document.getElementById('btn-delete-cv');
    const parsedContainer = document.getElementById('parsed-cv-container');
    const parsedTextarea = document.getElementById('parsed-cv-text');

    dropzone.addEventListener('click', () => fileInput.click());

    ['dragenter', 'dragover'].forEach(eventName => {
        dropzone.addEventListener(eventName, (e) => {
            e.preventDefault();
            dropzone.style.borderColor = 'var(--primary)';
        }, false);
    });

    ['dragleave', 'drop'].forEach(eventName => {
        dropzone.addEventListener(eventName, (e) => {
            e.preventDefault();
            dropzone.style.borderColor = '';
        }, false);
    });

    dropzone.addEventListener('drop', (e) => {
        const dt = e.dataTransfer;
        if (dt.files.length) handleCVFile(dt.files[0]);
    });

    fileInput.addEventListener('change', () => {
        if (fileInput.files.length) handleCVFile(fileInput.files[0]);
    });

    deleteBtn.addEventListener('click', () => {
        appState.cvUploaded = false;
        appState.cvFilename = '';
        infoBox.classList.add('hidden');
        dropzone.classList.remove('hidden');
        parsedContainer.classList.add('hidden');
        parsedTextarea.value = '';
        logToConsole('[CV] קורות החיים הוסרו.', 'info');
        updateStats();
    });

    async function handleCVFile(file) {
        if (file.type !== 'application/pdf') {
            showToast('אנא העלה קובץ PDF בלבד!', 'error');
            return;
        }

        logToConsole(`[CV] מעלה ומפענח קובץ: ${file.name}...`, 'info');
        
        const formData = new FormData();
        formData.append('cv', file);

        try {
            const response = await fetch('/api/upload-cv', {
                method: 'POST',
                body: formData
            });

            if (!response.ok) throw new Error('Parsing PDF failed');

            const data = await response.json();
            appState.cvUploaded = true;
            appState.cvFilename = file.name;
            
            filenameEl.textContent = file.name;
            parsedTextarea.value = data.text;
            parsedContainer.classList.remove('hidden');
            
            updateCVUploadUI();
            updateStats();
            logToConsole('[CV] קורות החיים נשמרו בשרת ומובנים לשימוש.', 'success');
            showToast('קורות החיים הועלו בהצלחה!');
        } catch (error) {
            logToConsole(`[CV ERROR] שגיאה בהעלאה: ${error.message}`, 'error');
            showToast('חילוץ קורות החיים נכשל.', 'error');
        }
    }
}

// Config Event Handlers
function setupConfigHandlers() {
    const keyInput = document.getElementById('gemini-key');
    const toggleKeyBtn = document.getElementById('btn-toggle-key-visibility');

    toggleKeyBtn.addEventListener('click', (e) => {
        e.preventDefault();
        if (keyInput.type === 'password') {
            keyInput.type = 'text';
            toggleKeyBtn.innerHTML = '<i class="fa-solid fa-eye-slash"></i>';
        } else {
            keyInput.type = 'password';
            toggleKeyBtn.innerHTML = '<i class="fa-solid fa-eye"></i>';
        }
    });

    // Save Auto-Pilot Config
    document.getElementById('btn-save-agent-config').addEventListener('click', async () => {
        const keywords = document.getElementById('agent-keywords').value.split(',').map(k => k.trim()).filter(Boolean);
        const settings = {
            geminiKey: keyInput.value.trim(),
            keywords,
            location: document.getElementById('agent-location').value.trim(),
            intervalHours: parseFloat(document.getElementById('agent-interval').value) || 4,
            matchThreshold: parseInt(document.getElementById('match-threshold').value, 10) || 75,
            dryRun: document.getElementById('dry-run-mode').checked,
            continuousMode: document.getElementById('continuous-mode').checked,
            candidatePhone: document.getElementById('candidate-phone').value.trim(),
            candidateLinkedin: document.getElementById('candidate-linkedin').value.trim()
        };

        try {
            const res = await fetch('/api/config', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(settings)
            });

            if (res.ok) {
                appState.settings = { ...appState.settings, ...settings };
                updateOverviewBox();
                showToast('הגדרות הסוכן נשמרו בהצלחה!');
                logToConsole('[CONFIG] הגדרות סוכן עודכנו בשרת.', 'success');
            } else {
                throw new Error('Save failed');
            }
        } catch (e) {
            showToast('שגיאה בשמירת ההגדרות.', 'error');
        }
    });

    // Save SMTP Config
    document.getElementById('btn-save-smtp-config').addEventListener('click', async () => {
        const settings = {
            senderName: document.getElementById('sender-name').value.trim(),
            smtpHost: document.getElementById('smtp-host').value.trim(),
            smtpPort: parseInt(document.getElementById('smtp-port').value, 10) || 465,
            smtpSecure: document.getElementById('smtp-secure').value,
            smtpUser: document.getElementById('smtp-user').value.trim(),
            smtpPass: document.getElementById('smtp-pass').value.trim()
        };

        try {
            const res = await fetch('/api/config', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(settings)
            });

            if (res.ok) {
                appState.settings = { ...appState.settings, ...settings };
                showToast('הגדרות דואר נשמרו בהצלחה!');
                logToConsole('[CONFIG] הגדרות SMTP עודכנו בשרת.', 'success');
            } else {
                throw new Error('Save failed');
            }
        } catch (e) {
            showToast('שגיאה בשמירת הגדרות דואר.', 'error');
        }
    });

    // Test SMTP
    document.getElementById('btn-test-smtp').addEventListener('click', async () => {
        const targetEmail = document.getElementById('test-email-target').value.trim();
        const testSmtp = {
            senderName: document.getElementById('sender-name').value.trim(),
            host: document.getElementById('smtp-host').value.trim(),
            port: parseInt(document.getElementById('smtp-port').value, 10) || 465,
            secure: document.getElementById('smtp-secure').value,
            user: document.getElementById('smtp-user').value.trim(),
            pass: document.getElementById('smtp-pass').value.trim()
        };

        if (!targetEmail || !testSmtp.host || !testSmtp.user || !testSmtp.pass) {
            showToast('יש למלא אימייל יעד והגדרות SMTP מלאות לבדיקה!', 'error');
            return;
        }

        logToConsole(`[SMTP TEST] שולח מייל בדיקה אל ${targetEmail}...`, 'info');
        
        try {
            const res = await fetch('/api/test-smtp', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ smtpConfig: testSmtp, targetEmail })
            });

            if (res.ok) {
                showToast('מייל הבדיקה נשלח בהצלחה!');
                logToConsole('[SMTP TEST] חיבור הצליח ומייל נשלח!', 'success');
            } else {
                const data = await res.json();
                throw new Error(data.error || 'Connection failed');
            }
        } catch (err) {
            showToast('חיבור SMTP נכשל.', 'error');
            logToConsole(`[SMTP TEST ERROR] חיבור נכשל: ${err.message}`, 'error');
        }
    });
}

// Controller logic to Start/Stop the Auto-Pilot scheduler
function setupAgentControllers() {
    const btnStart = document.getElementById('btn-start-agent');
    const btnStop = document.getElementById('btn-stop-agent');
    const btnClearLogs = document.getElementById('btn-clear-logs');
    const btnClearHistory = document.getElementById('btn-clear-history');

    btnStart.addEventListener('click', async () => {
        if (!appState.cvUploaded) {
            showToast('יש להעלות קובץ קורות חיים תחילה!', 'error');
            return;
        }
        if (!appState.settings.geminiKey) {
            showToast('נא למלא מפתח Gemini API בהגדרות!', 'error');
            return;
        }

        try {
            const res = await fetch('/api/start-autopilot', { method: 'POST' });
            if (res.ok) {
                appState.isRunning = true;
                btnStart.disabled = true;
                btnStop.disabled = false;
                
                setAgentStatusUI(true);
                connectSSEListener();
                
                logToConsole('סוכן ה-Auto-Pilot הופעל וירוץ ברקע.', 'success');
                showToast('הסוכן הופעל בהצלחה!');
            } else {
                const data = await res.json();
                throw new Error(data.error || 'Failed to start agent');
            }
        } catch (e) {
            showToast(e.message, 'error');
        }
    });

    btnStop.addEventListener('click', async () => {
        try {
            const res = await fetch('/api/stop-autopilot', { method: 'POST' });
            if (res.ok) {
                appState.isRunning = false;
                btnStart.disabled = false;
                btnStop.disabled = true;
                
                setAgentStatusUI(false);
                if (appState.sseSource) {
                    appState.sseSource.close();
                }
                
                showToast('הסוכן נעצר.');
            }
        } catch (e) {
            console.error('Error stopping agent', e);
        }
    });

    btnClearLogs.addEventListener('click', () => {
        document.getElementById('log-console').innerHTML = '';
        logToConsole('מסוף לוגים נוקה.', 'plain');
    });

    btnClearHistory.addEventListener('click', async () => {
        if (confirm('האם אתה בטוח שברצונך למחוק את כל היסטוריית ההגשות?')) {
            try {
                const res = await fetch('/api/clear-history', { method: 'POST' });
                if (res.ok) {
                    appState.history = [];
                    renderHistoryTable();
                    updateStats();
                    showToast('ההיסטוריה נמחקה בהצלחה.');
                    logToConsole('[SYSTEM] היסטוריית ההגשות נמחקה.', 'info');
                }
            } catch (e) {
                console.error(e);
            }
        }
    });
}

// Connect SSE listener
function connectSSEListener() {
    if (appState.sseSource) {
        appState.sseSource.close();
    }

    appState.sseSource = new EventSource('/api/status');
    
    appState.sseSource.onmessage = function(event) {
        try {
            const data = JSON.parse(event.data);
            
            if (data.type === 'connected') {
                appState.isRunning = data.isRunning;
                setAgentStatusUI(data.isRunning);
            } else if (data.type === 'state-change') {
                appState.isRunning = data.isRunning;
                setAgentStatusUI(data.isRunning);
            } else if (data.type === 'cycle-start') {
                logToConsole(data.message, 'info');
            } else if (data.type === 'cycle-end') {
                logToConsole(data.message, 'info');
            } else if (data.type === 'console-log') {
                logToConsole(data.text, data.status);
            } else if (data.type === 'history-update') {
                // Prepend or add new entry to history list
                appState.history.push(data.item);
                addHistoryRow(data.item, true);
                updateStats();
            } else if (data.type === 'error') {
                logToConsole(`[ERROR] ${data.message}`, 'error');
                showToast(data.message, 'error');
            }
        } catch (e) {
            console.error('Error parsing SSE event', e);
        }
    };
}

function setAgentStatusUI(isRunning) {
    const indicator = document.getElementById('agent-indicator');
    const text = document.getElementById('agent-status-text');
    const btnStart = document.getElementById('btn-start-agent');
    const btnStop = document.getElementById('btn-stop-agent');

    if (isRunning) {
        indicator.className = 'status-indicator online';
        text.textContent = 'סוכן פעיל ברקע';
        btnStart.disabled = true;
        btnStop.disabled = false;
    } else {
        indicator.className = 'status-indicator offline';
        text.textContent = 'הסוכן כבוי';
        btnStart.disabled = false;
        btnStop.disabled = true;
    }
}

// History table render
function renderHistoryTable() {
    const tbody = document.getElementById('history-list');
    tbody.innerHTML = '';

    if (appState.history.length === 0) {
        tbody.innerHTML = `
            <tr class="empty-row">
                <td colspan="7">לא נמצאה היסטוריית פעילות. הפעל את הסוכן בלשונית הבקרה.</td>
            </tr>
        `;
        return;
    }

    // Sort newest first
    const sorted = [...appState.history].sort((a,b) => new Date(b.timestamp) - new Date(a.timestamp));
    sorted.forEach(item => addHistoryRow(item, false));
}

function addHistoryRow(item, prepend = false) {
    const tbody = document.getElementById('history-list');
    
    if (appState.history.length === 1 && prepend) {
        tbody.innerHTML = '';
    }

    const tr = document.createElement('tr');
    
    let statusClass = 'status-pending';
    let statusText = 'לא מוגדר';
    if (item.status === 'skipped') { statusClass = 'status-pending'; statusText = 'דולגה'; }
    else if (item.status === 'applied') { statusClass = 'status-sent'; statusText = 'הוגשה'; }
    else if (item.status === 'dry-run') { statusClass = 'status-processing'; statusText = 'בדיקה (מולא)'; }
    else if (item.status === 'error') { statusClass = 'status-error'; statusText = 'שגיאה'; }
    else if (item.status === 'manual-review') { statusClass = 'status-processing'; statusText = 'לסקירה ידנית'; }

    let methodText = 'ללא';
    if (item.method === 'email') methodText = 'אימייל';
    else if (item.method === 'lever-form') methodText = 'טופס Lever';
    else if (item.method === 'greenhouse-form') methodText = 'טופס Greenhouse';

    const dateStr = new Date(item.timestamp).toLocaleString('he-IL', { hour: '2-digit', minute:'2-digit', second:'2-digit', day:'2-digit', month:'2-digit' });

    let proofCol = '<span class="text-muted">אין הוכחה</span>';
    if (item.details && item.details.startsWith('screenshots/')) {
        proofCol = `<a href="${item.details}" target="_blank" class="btn btn-outline" style="padding: 0.2rem 0.6rem; font-size: 0.8rem;"><i class="fa-solid fa-image"></i> צפה בצילום מסך</a>`;
    } else if (item.details) {
        proofCol = `<span class="text-muted" title="${item.details}">${item.details.substring(0, 15)}...</span>`;
    }

    tr.innerHTML = `
        <td>${dateStr}</td>
        <td>
            <div style="font-weight: bold;">${item.title}</div>
            <div style="font-size: 0.8rem; color: var(--text-muted);">${item.company}</div>
        </td>
        <td style="font-weight: bold; color: ${item.score >= 80 ? 'var(--success)' : 'var(--warning)'}">${item.score}%</td>
        <td style="font-size: 0.85rem; max-width: 250px; word-break: break-word;">${item.explanation || ''}</td>
        <td><span class="badge">${methodText}</span></td>
        <td><span class="recipient-status ${statusClass}">${statusText}</span></td>
        <td>${proofCol}</td>
    `;

    if (prepend) {
        tbody.insertBefore(tr, tbody.firstChild);
    } else {
        tbody.appendChild(tr);
    }
}

// Compute statistics dashboard variables
function updateStats() {
    const total = appState.history.length;
    const applied = appState.history.filter(h => h.status === 'applied' || h.status === 'dry-run').length;
    const skipped = appState.history.filter(h => h.status === 'skipped').length;

    const cvStatusEl = document.getElementById('stat-cv-status');
    if (appState.cvUploaded) {
        cvStatusEl.textContent = 'טעון';
        cvStatusEl.style.color = 'var(--success)';
    } else {
        cvStatusEl.textContent = 'לא הועלה';
        cvStatusEl.style.color = '';
    }

    document.getElementById('stat-scanned-count').textContent = total;
    document.getElementById('stat-applied-count').textContent = applied;
    document.getElementById('stat-skipped-count').textContent = skipped;

    drawMetricsChart();
}

// Draw dynamic metrics doughnut chart
function drawMetricsChart() {
    const ctx = document.getElementById('metricsChart');
    if (!ctx) return;

    const history = appState.history;
    const skipped = history.filter(h => h.status === 'skipped').length;
    const appliedLow = history.filter(h => (h.status === 'applied' || h.status === 'dry-run') && h.score < 85).length;
    const appliedHigh = history.filter(h => (h.status === 'applied' || h.status === 'dry-run') && h.score >= 85).length;

    if (appState.myChart) {
        appState.myChart.destroy();
    }

    const dataValues = [skipped, appliedLow, appliedHigh];
    const hasData = skipped > 0 || appliedLow > 0 || appliedHigh > 0;

    appState.myChart = new Chart(ctx, {
        type: 'doughnut',
        data: {
            labels: hasData ? ['משרות שדולגו', 'התאמה בינונית (75-85)', 'התאמה גבוהה (85+)'] : ['אין נתוני סריקה'],
            datasets: [{
                data: hasData ? dataValues : [1],
                backgroundColor: hasData ? [
                    'rgba(239, 68, 68, 0.4)',  // laser red
                    'rgba(245, 158, 11, 0.4)', // warning amber
                    'rgba(34, 197, 94, 0.4)'   // acid green
                ] : ['rgba(255, 255, 255, 0.05)'],
                borderColor: hasData ? [
                    'rgba(239, 68, 68, 0.8)',
                    'rgba(245, 158, 11, 0.8)',
                    'rgba(34, 197, 94, 0.8)'
                ] : ['rgba(255, 255, 255, 0.1)'],
                borderWidth: 1.5,
                hoverOffset: 4
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: {
                    position: 'right',
                    labels: {
                        color: '#f3f0f7',
                        font: { family: 'Rubik, Segoe UI', size: 11, weight: 'bold' },
                        boxWidth: 15
                    }
                }
            },
            cutout: '60%'
        }
    });
}

// Matrix Digital Rain Effect for Terminal
function initMatrixEffect() {
    const canvas = document.getElementById('matrix-canvas');
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    
    // Set canvas dimensions to match terminal
    canvas.width = canvas.parentElement.offsetWidth;
    canvas.height = canvas.parentElement.offsetHeight;
    
    // Matrix characters (Katakana + Latin + Numerals)
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789@#$%^&*אבגדהוזחטיכלמנסעפצקרשת';
    const charArray = chars.split('');
    
    const fontSize = 14;
    const columns = canvas.width / fontSize;
    const drops = [];
    
    // Initialize drops
    for (let x = 0; x < columns; x++) {
        drops[x] = 1;
    }
    
    function draw() {
        // Black BG for the canvas to show trail
        ctx.fillStyle = 'rgba(0, 0, 0, 0.05)';
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        
        ctx.fillStyle = 'rgba(168, 85, 247, 0.8)'; // Purple matrix color
        ctx.font = fontSize + 'px monospace';
        
        for (let i = 0; i < drops.length; i++) {
            const text = charArray[Math.floor(Math.random() * charArray.length)];
            ctx.fillText(text, i * fontSize, drops[i] * fontSize);
            
            if (drops[i] * fontSize > canvas.height && Math.random() > 0.975) {
                drops[i] = 0;
            }
            drops[i]++;
        }
    }
    
    setInterval(draw, 33);
    
    // Handle resize
    window.addEventListener('resize', () => {
        canvas.width = canvas.parentElement.offsetWidth;
        canvas.height = canvas.parentElement.offsetHeight;
    });
}

// Initialize matrix on load
document.addEventListener('DOMContentLoaded', () => {
    setTimeout(initMatrixEffect, 500);
});

// Tags Input UI Logic
function setupTagsInput() {
    const inputField = document.getElementById('tag-input');
    if (!inputField) return;
    
    inputField.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ',') {
            e.preventDefault();
            const val = inputField.value.trim();
            if (val) {
                addTag(val);
                inputField.value = '';
            }
        }
    });
}

function renderTags() {
    const container = document.getElementById('tags-container');
    const hiddenInput = document.getElementById('agent-keywords');
    if (!container || !hiddenInput) return;
    container.innerHTML = '';
    
    const currentTags = hiddenInput.value.split(',').map(t => t.trim()).filter(Boolean);
    currentTags.forEach(tag => {
        const tagEl = document.createElement('div');
        tagEl.className = 'tag';
        tagEl.innerHTML = `<span>${tag}</span><i class="fa-solid fa-xmark tag-remove" onclick="removeTag('${tag.replace(/'/g, "\\'")}')"></i>`;
        container.appendChild(tagEl);
    });
}

function addTag(tag) {
    const hiddenInput = document.getElementById('agent-keywords');
    if (!hiddenInput) return;
    let currentTags = hiddenInput.value.split(',').map(t => t.trim()).filter(Boolean);
    if (!currentTags.includes(tag)) {
        currentTags.push(tag);
        hiddenInput.value = currentTags.join(',');
        renderTags();
    }
}

window.removeTag = function(tagToRemove) {
    const hiddenInput = document.getElementById('agent-keywords');
    if (!hiddenInput) return;
    let currentTags = hiddenInput.value.split(',').map(t => t.trim()).filter(Boolean);
    currentTags = currentTags.filter(t => t !== tagToRemove);
    hiddenInput.value = currentTags.join(',');
    renderTags();
};
