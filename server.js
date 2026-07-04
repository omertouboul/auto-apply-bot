const express = require('express');
const nodemailer = require('nodemailer');
const multer = require('multer');
const pdfParse = require('pdf-parse');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const dotenv = require('dotenv');

// Load environment variables
dotenv.config();

const app = express();
const port = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.json({ limit: '15mb' }));
app.use(express.static(path.join(__dirname, 'public')));

// Configure Multer for memory storage
const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 5 * 1024 * 1024 } // 5MB Limit
});

const historyPath = path.join(__dirname, 'history.json');

// Initialize history file if it doesn't exist
if (!fs.existsSync(historyPath)) {
    fs.writeFileSync(historyPath, JSON.stringify([], null, 2), 'utf8');
}

// In-Memory App State
let queueState = {
    cvText: '',
    cvFilename: '',
    cvBuffer: null,
    settings: {
        keywords: [
            // English - Technical & Senior/Managerial
            'Network Engineer', 'Senior Network Engineer', 'Network Manager', 'IT Manager', 'Director of IT', 'VP of IT', 'CISO', 'Security Engineer', 'Senior Security Engineer', 'Cybersecurity Manager', 'System Administrator', 'Network Architect', 'Cloud Security Engineer', 'Head of IT', 'Infrastructure Manager',
            // Hebrew
            'מנהל רשתות', 'מהנדס רשת', 'מנהל אבטחת מידע', 'איש סיסטם', 'מנהל תשתיות', 'מנהל IT', 'ארכיטקט רשתות', 'ראש צוות תקשורת', 'מנהל טכנולוגיות',
            // Spanish
            'Ingeniero de Redes', 'Gerente de TI', 'Director de Seguridad de la Información', 'Administrador de Sistemas', 'Arquitecto de Redes', 'Director de TI',
            // French
            'Ingénieur Réseau', 'Responsable Informatique', 'Directeur de la Sécurité', 'Administrateur Système', 'Architecte Réseau', 'Directeur Informatique',
            // German
            'Netzwerkingenieur', 'IT-Manager', 'Sicherheitsbeauftragter', 'Systemadministrator', 'Netzwerkarchitekt', 'IT-Leiter'
        ],
        location: 'Global',
        matchThreshold: 70,
        intervalHours: 4,
        continuousMode: true,
        dryRun: true,
        geminiKey: '',
        smtpHost: 'smtp.gmail.com',
        smtpPort: 465,
        smtpUser: '',
        smtpPass: '',
        senderName: '',
        smtpSecure: 'true',
        candidatePhone: '',
        candidateLinkedin: ''
    },
    clients: [],
    isRunning: false,
    activeTimer: null
};

// Load saved config on startup if exists
const configPath = path.join(__dirname, 'config.json');
if (fs.existsSync(configPath)) {
    try {
        const saved = JSON.parse(fs.readFileSync(configPath, 'utf8'));
        queueState.settings = { ...queueState.settings, ...saved };
    } catch (e) {
        console.error('Error loading config file:', e);
    }
}

// Load saved CV from config dir if exists
const savedCvPath = path.join(__dirname, 'saved_cv.json');
if (fs.existsSync(savedCvPath)) {
    try {
        const savedCv = JSON.parse(fs.readFileSync(savedCvPath, 'utf8'));
        queueState.cvText = savedCv.cvText;
        queueState.cvFilename = savedCv.cvFilename;
        if (savedCv.cvBufferBase64) {
            queueState.cvBuffer = Buffer.from(savedCv.cvBufferBase64, 'base64');
        }
    } catch (e) {
        console.error('Error loading saved CV:', e);
    }
}

// Auto-start crawling cycle on boot if a CV is already loaded
if (queueState.cvText) {
    queueState.isRunning = true;
    console.log(`Auto-starting Auto-Pilot search loop on boot for CV: ${queueState.cvFilename}`);
    // Delay slightly to let the Express server start listening
    setTimeout(() => {
        runAutoApplyCycle();
    }, 2000);
}

// Read history utility
function getHistory() {
    try {
        if (fs.existsSync(historyPath)) {
            return JSON.parse(fs.readFileSync(historyPath, 'utf8'));
        }
    } catch (e) {
        console.error('Error reading history file:', e);
    }
    return [];
}

// Save history utility
function saveHistoryItem(item) {
    try {
        const history = getHistory();
        history.push(item);
        fs.writeFileSync(historyPath, JSON.stringify(history, null, 2), 'utf8');
    } catch (e) {
        console.error('Error writing to history file:', e);
    }
}

// SSE Endpoint for Live Updates
app.get('/api/status', (req, res) => {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders();

    queueState.clients.push(res);
    res.write(`data: ${JSON.stringify({ type: 'connected', isRunning: queueState.isRunning })}\n\n`);

    req.on('close', () => {
        queueState.clients = queueState.clients.filter(c => c !== res);
    });
});

// Broadcast Helper
function broadcast(eventData) {
    queueState.clients.forEach(client => {
        try {
            client.write(`data: ${JSON.stringify(eventData)}\n\n`);
        } catch (e) {
            // ignore closed connections
        }
    });
}

// Upload & Parse CV
app.post('/api/upload-cv', upload.single('cv'), async (req, res) => {
    if (!req.file) {
        return res.status(400).json({ error: 'לא הועלה קובץ.' });
    }
    
    try {
        const data = await pdfParse(req.file.buffer);
        queueState.cvText = data.text;
        queueState.cvFilename = req.file.originalname;
        queueState.cvBuffer = req.file.buffer;

        // Save CV to disk for persistence across restarts
        fs.writeFileSync(savedCvPath, JSON.stringify({
            cvText: data.text,
            cvFilename: req.file.originalname,
            cvBufferBase64: req.file.buffer.toString('base64')
        }, null, 2), 'utf8');
        
        res.json({ text: data.text, filename: req.file.originalname });
    } catch (err) {
        console.error('PDF parsing error:', err);
        res.status(500).json({ error: 'חילוץ הטקסט מקובץ ה-PDF נכשל.' });
    }
});

// Connection test for SMTP settings
app.post('/api/test-smtp', async (req, res) => {
    const { smtpConfig, targetEmail } = req.body;
    
    if (!smtpConfig || !targetEmail) {
        return res.status(400).json({ error: 'פרמטרים חסרים לביצוע בדיקה.' });
    }

    try {
        const transporter = nodemailer.createTransport({
            host: smtpConfig.host,
            port: parseInt(smtpConfig.port, 10),
            secure: smtpConfig.secure === 'true',
            auth: {
                user: smtpConfig.user,
                pass: smtpConfig.pass
            },
            tls: { rejectUnauthorized: false }
        });

        await transporter.sendMail({
            from: `"${smtpConfig.senderName || 'AutoResume Test'}" <${smtpConfig.user}>`,
            to: targetEmail,
            subject: 'בדיקת חיבור AutoResume SMTP Connection',
            text: 'מזל טוב! שרת ה-SMTP הוגדר בהצלחה. סוכן ה-Auto-Apply שלך מוכן להרצה.'
        });

        res.json({ success: true });
    } catch (err) {
        console.error('SMTP test error:', err);
        res.status(500).json({ error: err.message });
    }
});

// Fetch current state settings and history
app.get('/api/config', (req, res) => {
    res.json({
        settings: queueState.settings,
        cvUploaded: !!queueState.cvText,
        cvFilename: queueState.cvFilename,
        history: getHistory()
    });
});

// Update configurations
app.post('/api/config', (req, res) => {
    const newSettings = req.body;
    if (!newSettings) return res.status(400).json({ error: 'Settings empty' });

    queueState.settings = { ...queueState.settings, ...newSettings };
    fs.writeFileSync(configPath, JSON.stringify(queueState.settings, null, 2), 'utf8');

    res.json({ success: true, settings: queueState.settings });
});

// Start background Auto-Pilot
app.post('/api/start-autopilot', (req, res) => {
    if (!queueState.cvText) {
        return res.status(400).json({ error: 'נא להעלות קובץ קורות חיים בסיסי תחילה.' });
    }
    if (!queueState.settings.geminiKey) {
        return res.status(400).json({ error: 'נא להגדיר מפתח Gemini API תקין.' });
    }

    if (queueState.isRunning) {
        return res.json({ status: 'already running' });
    }

    queueState.isRunning = true;
    broadcast({ type: 'state-change', isRunning: true });

    // Execute first search cycle immediately
    runAutoApplyCycle();

    res.json({ status: 'started' });
});

// Stop background Auto-Pilot
app.post('/api/stop-autopilot', (req, res) => {
    queueState.isRunning = false;
    if (queueState.activeTimer) {
        clearTimeout(queueState.activeTimer);
        queueState.activeTimer = null;
    }
    broadcast({ type: 'state-change', isRunning: false });
    broadcast({ type: 'console-log', text: 'סוכן ה-Auto-Pilot נעצר על ידי המשתמש.', status: 'warning' });
    res.json({ status: 'stopped' });
});

// Clear history log
app.post('/api/clear-history', (req, res) => {
    fs.writeFileSync(historyPath, JSON.stringify([], null, 2), 'utf8');
    res.json({ success: true });
});

// Yahoo Search Scraper utility (bypasses bot captchas and yields clean listings)
async function searchJobs(keyword, location) {
    // If location is Global, we don't restrict by location string
    const locQuery = location === 'Global' ? '' : `"${location}"`;
    const query = `"${keyword}" jobs ${locQuery} (site:lever.co OR site:greenhouse.io) -United Arab Emirates -UAE -Dubai -Saudi Arabia -Qatar -Bahrain -Kuwait -Oman -Egypt -Jordan -Lebanon -Iraq -Iran -Syria -Yemen -Morocco -Algeria -Tunisia -Libya -Sudan -Pakistan -Afghanistan -Malaysia -Indonesia`.trim();
    
    let allUrls = [];
    
    try {
        // Fetch up to 5 pages of Yahoo search results
        for (let page = 0; page < 5; page++) {
            const b = page * 10 + 1; // Yahoo pagination parameter: b=1, b=11, b=21...
            const url = `https://search.yahoo.com/search?p=${encodeURIComponent(query)}&b=${b}`;
            
            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), 10000); 

            const res = await fetch(url, {
                headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/100.0.0.0 Safari/537.36' },
                signal: controller.signal
            });
            clearTimeout(timeoutId);
            const html = await res.text();
            
            // Yahoo redirect pattern: RU=http...
            const matches = [...html.matchAll(/RU=([^/&"']+)/g)];
            const urls = matches.map(m => decodeURIComponent(m[1])).filter(u => {
                const low = u.toLowerCase();
                return u.startsWith('http') && 
                       !low.includes('yahoo.com') && 
                       !low.includes('yimg.com') && 
                       !low.includes('flickr.com') &&
                       !low.includes('help.yahoo.com') &&
                       (low.includes('lever.co') || low.includes('greenhouse.io') || low.includes('careers'));
            });
            
            allUrls.push(...urls);
            
            // Small delay to prevent rate-limiting by Yahoo
            await new Promise(r => setTimeout(r, 1500));
        }
        
        // Return unique URLs, cap at 100 per keyword to maintain quality
        return [...new Set(allUrls)].slice(0, 100);
    } catch (e) {
        console.error("Yahoo search error:", e.message);
        return [...new Set(allUrls)]; // Return whatever we gathered before error
    }
}

// Scrape text content from webpage
async function getPageText(url) {
    try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 12000); // 12 seconds timeout

        const res = await fetch(url, {
            headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/99.0.4844.51 Safari/537.36' },
            signal: controller.signal
        });
        clearTimeout(timeoutId);
        
        const html = await res.text();
        
        // Remove style, script tags and strip html elements
        let text = html
            .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
            .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
            .replace(/<[^>]+>/g, ' ')
            .replace(/\s+/g, ' ')
            .trim();
            
        return text.substring(0, 10000); // Cap at 10,000 characters to save token limits
    } catch (e) {
        console.error(`Scraping failed for URL ${url}:`, e.message);
        return '';
    }
}

// Evaluate match and extract details using Gemini API (with local keyword-based fallback)
async function evaluateJobMatch(cvText, jobText, geminiKey, url = '') {
    // Attempt Gemini evaluation if a key is provided and looks valid
    const keyValid = geminiKey && geminiKey.trim().startsWith('AIzaSy');
    
    if (keyValid) {
        try {
            const { GoogleGenerativeAI } = require('@google/generative-ai');
            const genAI = new GoogleGenerativeAI(geminiKey.trim());
            const model = genAI.getGenerativeModel({ 
                model: 'gemini-1.5-flash',
                generationConfig: { responseMimeType: "application/json" }
            });

            const prompt = `
            You are an automated job application matcher. 
            Analyze the following job description text and the candidate's resume.
            
            Determine:
            1. Match Score: A score from 0 to 100 on how well the candidate's skills match the job requirements.
            2. Explanation: A 1-sentence explanation of why they match or mismatch (in Hebrew).
            3. Company Name: Extract the company name (if found, otherwise 'Unknown').
            4. Job Title: Extract the job title (if found, otherwise 'Unknown').
            5. Recruiter Email: Extract a contact email address for job applications if explicitly mentioned in the text (e.g. jobs@company.com, hr@company.com). If none is found, return null.
            
            Candidate Resume:
            ---
            ${cvText}
            ---

            Job Description Text:
            ---
            ${jobText}
            ---

            Output JSON in this format:
            {
                "score": 85,
                "explanation": "המועמד בעל ניסיון רב ב-React ו-Node.js התואמים את דרישות התפקיד.",
                "company": "Google",
                "title": "Software Engineer",
                "email": "hr@google.com"
            }
            `;

            const result = await model.generateContent(prompt);
            const response = await result.response;
            const jsonText = response.text().trim();
            return JSON.parse(jsonText);
        } catch (e) {
            console.error("Gemini API call failed, falling back to local matching:", e.message);
        }
    } else {
        console.log("No valid Gemini key (starts with AIzaSy) found. Using local rule-based matching engine.");
    }

    // --- LOCAL FALLBACK MATCHING ENGINE ---
    // Extract company name from URL
    let company = 'חברה';
    if (url) {
        const u = url.toLowerCase();
        if (u.includes('lever.co/')) {
            const parts = u.split('lever.co/');
            if (parts[1]) company = parts[1].split('/')[0];
        } else if (u.includes('greenhouse.io/')) {
            const parts = u.split('greenhouse.io/');
            if (parts[1]) company = parts[1].split('/')[0];
        }
        // Capitalize company name
        if (company) {
            company = company.charAt(0).toUpperCase() + company.slice(1);
        }
    }

    // Try to extract job title from first few lines of text
    let title = 'איש תקשורת ורשתות';
    const lines = jobText.split('\n').map(l => l.trim()).filter(l => l.length > 5);
    if (lines.length > 0) {
        // Find first line that looks like a title (e.g., shorter than 70 chars)
        const possibleTitle = lines.find(l => l.length < 70 && !l.includes('http') && !l.includes('apply'));
        if (possibleTitle) {
            title = possibleTitle;
        } else {
            title = lines[0].length < 70 ? lines[0] : lines[0].substring(0, 70) + '...';
        }
    }

    // Extract email if present
    let email = null;
    const emailRegex = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/;
    const emailMatch = jobText.match(emailRegex);
    if (emailMatch) {
        email = emailMatch[0];
    }

    // Calculate keyword matching score
    const targetKeywords = [
        'network', 'cisco', 'check point', 'firewall', 'routing', 'switching', 
        'תקשורת', 'רשתות', 'אבטחה', 'f5', 'fortinet', 'ccna', 'ccnp', 'lan', 'wan'
    ];
    
    let matchedKeywords = [];
    const jobTextLower = jobText.toLowerCase();
    
    targetKeywords.forEach(kw => {
        if (jobTextLower.includes(kw)) {
            matchedKeywords.push(kw);
        }
    });

    // Score calculations
    let score = 65; // base score if it's scanned
    if (matchedKeywords.length > 0) {
        score += Math.min(matchedKeywords.length * 8, 30); // add up to 30 points
    }
    
    // Safety check - make sure at least 'network' or 'תקשורת' or 'רשתות' or 'firewall' is present to get a high score
    const hasCore = jobTextLower.includes('network') || 
                    jobTextLower.includes('תקשורת') || 
                    jobTextLower.includes('רשת') || 
                    jobTextLower.includes('firewall');
                    
    if (!hasCore) {
        score = Math.max(score - 30, 30); // penalize if core words are missing
    }

    const explanation = `התאמה מקומית (מבוסס מילות מפתח: ${matchedKeywords.join(', ') || 'בסיס'}).`;

    return {
        score,
        explanation,
        company,
        title,
        email
    };
}

// Generate cover letter text
async function generateCoverLetterText(cvText, evalResult, geminiKey) {
    const { GoogleGenerativeAI } = require('@google/generative-ai');
    const genAI = new GoogleGenerativeAI(geminiKey);
    const model = genAI.getGenerativeModel({ model: 'gemini-1.5-flash' });

    const prompt = `
    אתה עוזר גיוס מקצועי בדרגה ראשונה. תפקידך לנסח מכתב פנייה (Cover Letter) קצר, ממוקד ומרשים ביותר עבור מנהל הגיוס, בהתבסס על קורות החיים של המועמד ותיאור המשרה.
    שם חברה: ${evalResult.company}
    משרה: ${evalResult.title}
    הסבר התאמה: ${evalResult.explanation}
    
    קורות החיים הבסיסיים שלי:
    ---
    ${cvText}
    ---

    הנחיות לניסוח:
    1. כתוב מכתב תמציתי ומקצועי (עד 3 פסקאות קצרות, כ-120 מילים).
    2. הדגש כיצד הניסיון והכישורים של המועמד מתאימים ישירות לדרישות התפקיד.
    3. כתוב בשפה המתאימה (אנגלית אם פרטי המשרה באנגלית, אחרת בעברית).
    4. כתוב את מכתב הפנייה בלבד. אל תכלול שום טקסט מבוא או סיום מלבד מכתב הפנייה עצמו.
    `;

    try {
        const result = await model.generateContent(prompt);
        const response = await result.response;
        return response.text().trim();
    } catch (e) {
        console.error("Cover letter generation failed:", e);
        return `Hello HR Team,\n\nI am very excited to apply for the position of ${evalResult.title} at ${evalResult.company}. Please find my attached CV.`;
    }
}

// Send customized email (with premium designed HTML layout)
async function sendEmailApplication(evalResult, settings, cvText, cvBuffer, cvFilename) {
    const coverLetter = await generateCoverLetterText(cvText, evalResult, settings.geminiKey);
    const coverLetterHtml = coverLetter.replace(/\n/g, '<br>');
    
    const transporter = nodemailer.createTransport({
        host: settings.smtpHost,
        port: parseInt(settings.smtpPort, 10),
        secure: settings.smtpSecure === 'true',
        auth: {
            user: settings.smtpUser,
            pass: settings.smtpPass
        },
        tls: { rejectUnauthorized: false }
    });

    const htmlContent = `
    <!DOCTYPE html>
    <html lang="he" dir="rtl">
    <head>
        <meta charset="utf-8">
        <style>
            body { font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; color: #1e293b; line-height: 1.6; margin: 0; padding: 0; background-color: #f8fafc; }
            .container { max-width: 600px; margin: 30px auto; border: 1px solid #e2e8f0; border-radius: 16px; overflow: hidden; box-shadow: 0 10px 25px -5px rgba(0, 0, 0, 0.05); background-color: #ffffff; }
            .header { background: linear-gradient(135deg, #6d28d9, #4f46e5); color: #ffffff; padding: 35px 30px; text-align: right; }
            .header h1 { margin: 0; font-size: 24px; font-weight: 800; letter-spacing: -0.5px; }
            .header p { margin: 8px 0 0 0; opacity: 0.9; font-size: 14px; font-weight: 500; }
            .content { padding: 35px 30px; font-size: 16px; text-align: left; direction: ltr; color: #334155; }
            .signature-card { margin-top: 35px; padding: 25px; background-color: #f1f5f9; border-radius: 12px; border-right: 4px solid #6d28d9; text-align: right; direction: rtl; }
            .signature-name { font-weight: 800; font-size: 18px; color: #0f172a; }
            .signature-title { color: #64748b; font-size: 14px; margin-bottom: 12px; font-weight: 600; }
            .signature-contact { font-size: 13px; color: #475569; margin: 4px 0; }
            .signature-contact a { color: #4f46e5; text-decoration: none; font-weight: 600; }
            .signature-contact a:hover { text-decoration: underline; }
            .footer { background-color: #f8fafc; padding: 20px 30px; font-size: 11px; color: #94a3b8; text-align: center; border-top: 1px solid #f1f5f9; }
        </style>
    </head>
    <body>
        <div class="container">
            <div class="header">
                <h1>מועמדות למשרת ${evalResult.title}</h1>
                <p>פנייה מאת ${settings.senderName}</p>
            </div>
            <div class="content">
                ${coverLetterHtml}
            </div>
            <div class="signature-card">
                <div class="signature-name">${settings.senderName}</div>
                <div class="signature-title">איש תקשורת ואבטחת מידע / Network Specialist</div>
                <div class="signature-contact">📞 טלפון ליצירת קשר: ${settings.candidatePhone || '050-6689447'}</div>
                <div class="signature-contact">📧 דואר אלקטרוני: ${settings.smtpUser || 'omer.touboul@boi.org.il'}</div>
                ${settings.candidateLinkedin ? `<div class="signature-contact">🔗 פרופיל LinkedIn: <a href="${settings.candidateLinkedin}">${settings.candidateLinkedin}</a></div>` : ''}
            </div>
            <div class="footer">
                נשלח אוטומטית באמצעות סוכן הגיוס החכם AutoApply AI.
            </div>
        </div>
    </body>
    </html>
    `;

    const mailOptions = {
        from: `"${settings.senderName || 'AutoResume Client'}" <${settings.smtpUser}>`,
        to: evalResult.email,
        subject: `Application for ${evalResult.title} - ${settings.senderName}`,
        text: coverLetter, // Fallback for plain text clients
        html: htmlContent
    };

    if (cvBuffer) {
        mailOptions.attachments = [{
            filename: cvFilename || 'resume.pdf',
            content: cvBuffer
        }];
    }

    await transporter.sendMail(mailOptions);
}

// Playwright auto-fill form handler (with resilient selectors and robust fallback)
async function playwrightSubmitForm(url, settings, cvBuffer, cvFilename, evalResult) {
    const { chromium } = require('playwright');
    
    // Launch headless browser
    const browser = await chromium.launch({ headless: true });
    const page = await browser.newPage();
    
    try {
        await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 45000 });
        // Give the page an extra second to execute client scripts safely
        await page.waitForTimeout(1500);
        
        // Ensure screenshots directory exists under public
        const screenshotsDir = path.join(__dirname, 'public', 'screenshots');
        if (!fs.existsSync(screenshotsDir)) {
            fs.mkdirSync(screenshotsDir, { recursive: true });
        }
        
        const companySanitized = evalResult.company.replace(/[^a-zA-Z0-9_\-]/g, '_');
        const screenshotFilename = `screenshot-${Date.now()}-${companySanitized}.png`;
        const screenshotPath = path.join(screenshotsDir, screenshotFilename);

        // Helper to fill fields safely without throwing crashes
        const safeFill = async (selectors, value) => {
            for (const selector of selectors) {
                try {
                    const el = await page.$(selector);
                    if (el) {
                        await el.fill(value);
                        return true;
                    }
                } catch (e) {}
            }
            return false;
        };

        // If page has a visible "Apply" or "Apply Now" button, click it first to reveal the form
        try {
            const applySelectors = [
                'a[href*="#app"]', 
                'a[href*="/apply"]', 
                'button:has-text("Apply")', 
                'a:has-text("Apply")',
                'button[id*="apply"]',
                'a[id*="apply"]'
            ];
            for (const sel of applySelectors) {
                const btn = await page.$(sel);
                if (btn && await btn.isVisible()) {
                    await btn.click();
                    await page.waitForTimeout(1500);
                    break;
                }
            }
        } catch (e) {
            console.log("No visible 'Apply' button to pre-click or error click:", e.message);
        }

        // Standard Lever Form Auto-fill
        if (url.includes('lever.co')) {
            await safeFill(['input[name="name"]', 'input[id="name"]'], settings.senderName);
            await safeFill(['input[name="email"]', 'input[id="email"]'], settings.smtpUser || settings.senderName + "@example.com");
            if (settings.candidatePhone) {
                await safeFill(['input[name="phone"]'], settings.candidatePhone);
            }
            if (settings.candidateLinkedin) {
                await safeFill(['input[name="urls[LinkedIn]"]'], settings.candidateLinkedin);
            }
            
            // Cover letter text
            const coverLetter = await generateCoverLetterText(queueState.cvText, evalResult, settings.geminiKey);
            await safeFill(['textarea[name="comments"]', 'textarea[id="comments"]'], coverLetter);
            
            // Upload PDF resume
            const fileInput = await page.$('input[type="file"][name="resume"], input[type="file"]');
            if (fileInput && cvBuffer) {
                await fileInput.setInputFiles({
                    name: cvFilename || 'resume.pdf',
                    mimeType: 'application/pdf',
                    buffer: cvBuffer
                });
            }
            
            await page.waitForTimeout(3000); // Allow file processing time
            await page.screenshot({ path: screenshotPath, fullPage: true });

            if (!settings.dryRun) {
                const submitBtn = await page.$('button[type="submit"], #btn-submit');
                if (submitBtn) {
                    await submitBtn.click();
                    await page.waitForTimeout(4000);
                }
            }

            await browser.close();
            return `screenshots/${screenshotFilename}`;
        }
        
        // Standard Greenhouse Form Auto-fill
        if (url.includes('greenhouse.io')) {
            const nameParts = settings.senderName.split(' ');
            const firstName = nameParts[0] || '';
            const lastName = nameParts.slice(1).join(' ') || 'Candidate';
            
            await safeFill(['input#first_name', 'input[name*="first_name" i]', 'input[placeholder*="first name" i]'], firstName);
            await safeFill(['input#last_name', 'input[name*="last_name" i]', 'input[placeholder*="last name" i]'], lastName);
            await safeFill(['input#email', 'input[name*="email" i]', 'input[type="email"]'], settings.smtpUser || settings.senderName + "@example.com");
            
            if (settings.candidatePhone) {
                await safeFill(['input#phone', 'input[name*="phone" i]', 'input[type="tel"]'], settings.candidatePhone);
            }
            
            if (settings.candidateLinkedin) {
                await safeFill([
                    'input[placeholder*="LinkedIn"]', 
                    'input[name*="linkedin" i]', 
                    'input[id*="linkedin" i]', 
                    'input[name*="urls[LinkedIn]"]'
                ], settings.candidateLinkedin);
            }

            // Upload PDF resume
            const fileInput = await page.$('input[type="file"]');
            if (fileInput && cvBuffer) {
                await fileInput.setInputFiles({
                    name: cvFilename || 'resume.pdf',
                    mimeType: 'application/pdf',
                    buffer: cvBuffer
                });
            }

            await page.waitForTimeout(3000); // Wait for file upload processing
            await page.screenshot({ path: screenshotPath, fullPage: true });

            if (!settings.dryRun) {
                const submitBtn = await page.$('input[type="submit"]', 'button[type="submit"]', '#submit_app');
                if (submitBtn) {
                    await submitBtn.click();
                    await page.waitForTimeout(4000);
                }
            }

            await browser.close();
            return `screenshots/${screenshotFilename}`;
        }

        // Generic fallback form auto-filler for other platforms
        await safeFill(['input[type="email"]', 'input[placeholder*="email" i]', 'input[name*="email" i]'], settings.smtpUser || settings.senderName + "@example.com");
        await safeFill(['input[placeholder*="name" i]', 'input[name*="name" i]', 'input[id*="name" i]'], settings.senderName);

        if (settings.candidatePhone) {
            await safeFill(['input[type="tel"]', 'input[placeholder*="phone" i]', 'input[name*="phone" i]'], settings.candidatePhone);
        }

        const fileInput = await page.$('input[type="file"]');
        if (fileInput && cvBuffer) {
            await fileInput.setInputFiles({
                name: cvFilename || 'resume.pdf',
                mimeType: 'application/pdf',
                buffer: cvBuffer
            });
        }

        await page.waitForTimeout(2000);
        await page.screenshot({ path: screenshotPath, fullPage: true });
        
        await browser.close();
        return `screenshots/${screenshotFilename}`;

    } catch (e) {
        await browser.close();
        throw e;
    }
}

// Background sweep engine
async function runAutoApplyCycle() {
    if (!queueState.isRunning) return;

    broadcast({ type: 'cycle-start', message: 'סבב סריקה והגשה אוטומטית החל כעת...' });

    const keywords = queueState.settings.keywords;
    const location = queueState.settings.location;
    const history = getHistory();
    const processedUrls = new Set(history.map(item => item.url));

    for (const kw of keywords) {
        if (!queueState.isRunning) break;
        broadcast({ type: 'console-log', text: `מחפש משרות עבור: "${kw}" במיקום: "${location}"...`, status: 'info' });

        const jobUrls = await searchJobs(kw, location);
        broadcast({ type: 'console-log', text: `נמצאו ${jobUrls.length} קישורים פוטנציאליים מחיפוש הרשת.`, status: 'info' });

        for (const url of jobUrls) {
            if (!queueState.isRunning) break;
            if (processedUrls.has(url)) continue; // Skip already processed

            // 1. URL level check for Bank of Israel
            const lowUrl = url.toLowerCase();
            if (lowUrl.includes('boi.gov.il') || lowUrl.includes('boi.org.il') || lowUrl.includes('bankofisrael') || lowUrl.includes('בנק-ישראל')) {
                const item = {
                    url,
                    company: 'בנק ישראל',
                    title: 'משרה מסוננת',
                    score: 0,
                    explanation: 'דילוג אוטומטי - מעסיק נוכחי',
                    status: 'skipped',
                    method: 'none',
                    timestamp: new Date().toISOString()
                };
                saveHistoryItem(item);
                broadcast({ type: 'history-update', item });
                broadcast({ type: 'console-log', text: `מעסיק נוכחי: דילוג בטוח על קישור השייך לבנק ישראל (${url})`, status: 'warning' });
                continue;
            }

            broadcast({ type: 'console-log', text: `סורק ומנתח את עמוד המשרה: ${url}`, status: 'info' });

            const pageText = await getPageText(url);
            if (!pageText || pageText.length < 150) {
                console.log(`Text too short for URL: ${url}`);
                continue;
            }

            // 1.5 Country Filter (Reject Arab/Islamic countries)
            const forbiddenCountries = ['dubai', 'uae', 'united arab emirates', 'saudi arabia', 'qatar', 'bahrain', 'kuwait', 'oman', 'egypt', 'jordan', 'lebanon', 'iraq', 'iran', 'syria', 'yemen', 'morocco', 'algeria', 'tunisia', 'libya', 'sudan', 'pakistan', 'afghanistan', 'malaysia', 'indonesia', 'riyadh', 'jeddah', 'doha', 'abu dhabi', 'amman', 'cairo', 'beirut'];
            const pTextLower = pageText.toLowerCase();
            const urlLower = url.toLowerCase();
            
            let isForbidden = false;
            for (const country of forbiddenCountries) {
                if (urlLower.includes(country.replace(' ', '')) || urlLower.includes(country.replace(' ', '-'))) {
                    isForbidden = true;
                    break;
                }
                // Check if the country is mentioned prominently in the text
                const regex = new RegExp(`\\b${country}\\b`, 'i');
                if (regex.test(pTextLower)) {
                    isForbidden = true;
                    break;
                }
            }

            if (isForbidden) {
                const item = {
                    url,
                    company: 'Unknown',
                    title: 'משרה מסוננת',
                    score: 0,
                    explanation: 'דילוג אוטומטי - מיקום מסונן (מדינות אסורות)',
                    status: 'skipped',
                    method: 'none',
                    timestamp: new Date().toISOString()
                };
                saveHistoryItem(item);
                broadcast({ type: 'history-update', item });
                broadcast({ type: 'console-log', text: `מיקום מסונן: דילוג על משרה במיקום לא רצוי (${url})`, status: 'warning' });
                continue;
            }

            // Gemini Match Scoring
            const evalResult = await evaluateJobMatch(queueState.cvText, pageText, queueState.settings.geminiKey, url);
            
            // 2. Company Name and Page Text check for Bank of Israel
            const compLower = (evalResult.company || '').toLowerCase();
            const textLower = pageText.toLowerCase();
            if (compLower.includes('bank of israel') || compLower.includes('בנק ישראל') || compLower.includes('boi') || 
                textLower.includes('בנק ישראל') || textLower.includes('bank of israel') || textLower.includes('boi.org.il')) {
                
                const item = {
                    url,
                    company: evalResult.company || 'בנק ישראל',
                    title: evalResult.title || 'משרה מסוננת',
                    score: evalResult.score,
                    explanation: 'דילוג אוטומטי - מעסיק נוכחי',
                    status: 'skipped',
                    method: 'none',
                    timestamp: new Date().toISOString()
                };
                saveHistoryItem(item);
                broadcast({ type: 'history-update', item });
                broadcast({ type: 'console-log', text: `מעסיק נוכחי: דילוג בטוח על משרה ב-${evalResult.company || 'בנק ישראל'} כדי למנוע כפילות.`, status: 'warning' });
                continue;
            }
            
            if (evalResult.score < queueState.settings.matchThreshold) {
                const item = {
                    url,
                    company: evalResult.company,
                    title: evalResult.title,
                    score: evalResult.score,
                    explanation: evalResult.explanation,
                    status: 'skipped',
                    method: 'none',
                    timestamp: new Date().toISOString()
                };
                saveHistoryItem(item);
                broadcast({ type: 'history-update', item });
                broadcast({ type: 'console-log', text: `משרה דולגה: ${evalResult.title} ב-${evalResult.company} (ציון התאמה: ${evalResult.score}) - ${evalResult.explanation}`, status: 'warning' });
                continue;
            }

            // Apply process
            broadcast({ type: 'console-log', text: `נמצאה משרה מתאימה! ${evalResult.title} ב-${evalResult.company} (התאמה: ${evalResult.score}%). מגיש מועמדות...`, status: 'success' });

            let appStatus = 'applied';
            let appMethod = 'email';
            let details = '';

            if (url.includes('lever.co') || url.includes('greenhouse.io')) {
                appMethod = url.includes('lever.co') ? 'lever-form' : 'greenhouse-form';
                try {
                    const screenshotUrl = await playwrightSubmitForm(url, queueState.settings, queueState.cvBuffer, queueState.cvFilename, evalResult);
                    details = screenshotUrl;
                    if (queueState.settings.dryRun) {
                        appStatus = 'dry-run';
                        broadcast({ 
                            type: 'console-log', 
                            text: `[מצב בדיקה] הטופס מולא בהצלחה עבור ${evalResult.title} ב-${evalResult.company}. צילום מסך נשמר.`, 
                            status: 'success' 
                        });
                    } else {
                        broadcast({ type: 'console-log', text: `המועמדות הוגשה בהצלחה דרך טופס המשרה!`, status: 'success' });
                    }
                } catch (err) {
                    console.error('Playwright apply error:', err);
                    appStatus = 'error';
                    details = err.message;
                    broadcast({ type: 'console-log', text: `שגיאה בהגשה אוטומטית לטופס: ${err.message}`, status: 'error' });
                }
            } else if (evalResult.email) {
                appMethod = 'email';
                try {
                    await sendEmailApplication(evalResult, queueState.settings, queueState.cvText, queueState.cvBuffer, queueState.cvFilename);
                    broadcast({ type: 'console-log', text: `מכתב פנייה מותאם נשלח במייל אל: ${evalResult.email}`, status: 'success' });
                } catch (err) {
                    console.error('Email send error:', err);
                    appStatus = 'error';
                    details = err.message;
                    broadcast({ type: 'console-log', text: `שגיאה בשליחת מועמדות למייל: ${err.message}`, status: 'error' });
                }
            } else {
                appStatus = 'manual-review';
                appMethod = 'none';
                broadcast({ type: 'console-log', text: `ציון ההתאמה גבוה אך לא נמצאה כתובת מייל או טופס נתמך. נשמר לסקירה ידנית.`, status: 'warning' });
            }

            const item = {
                url,
                company: evalResult.company,
                title: evalResult.title,
                score: evalResult.score,
                explanation: evalResult.explanation,
                status: appStatus,
                method: appMethod,
                details: details,
                timestamp: new Date().toISOString()
            };
            saveHistoryItem(item);
            broadcast({ type: 'history-update', item });

            // Politeness delay between submits (12 seconds)
            await new Promise(r => setTimeout(r, 12000));
        }
    }

    if (queueState.settings.continuousMode === true) {
        broadcast({ type: 'cycle-end', message: `סבב סריקה הסתיים. מריץ סבב סריקה נוסף ללא הפסקה (בעוד 45 שניות)...` });
        queueState.activeTimer = setTimeout(runAutoApplyCycle, 45 * 1000);
    } else {
        broadcast({ type: 'cycle-end', message: `סבב סריקה הסתיים. הסבב הבא מתוזמן לעוד ${queueState.settings.intervalHours} שעות.` });
        queueState.activeTimer = setTimeout(runAutoApplyCycle, queueState.settings.intervalHours * 60 * 60 * 1000);
    }
}

// Start Server listener
app.listen(port, () => {
    console.log(`AutoResume engine running on http://localhost:${port}`);
});
