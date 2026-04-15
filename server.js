// ============================================================
//  مكتبة المواد الدراسية — Express Backend Server (OAuth2)
// ============================================================
//
//  This server provides two endpoints:
//
//    GET  /folders  →  Returns the Google Drive folder tree as JSON
//    POST /upload   →  Uploads files to a specific Google Drive folder
//
//  SETUP INSTRUCTIONS:
//  -------------------
//  1. Go to https://console.cloud.google.com
//  2. Create a project (or use an existing one)
//  3. Enable the "Google Drive API":
//     - APIs & Services → Enable APIs → search "Google Drive API" → Enable
//
//  4. Create OAuth2 credentials:
//     - APIs & Services → Credentials → Create Credentials → OAuth client ID
//     - Application type: "Desktop app" (or "Web application")
//     - Click "Create"
//     - Click "Download JSON" (the download button)
//
//  5. Rename the downloaded file to:
//     👉  credentials.json
//     And place it in this folder (next to server.js)
//
//  6. Set your MAIN_FOLDER_ID below (line ~52)
//
//  7. Run:
//     npm install
//     npm start
//
//  8. FIRST TIME ONLY:
//     - The server will print a URL in the terminal
//     - Open that URL in your browser
//     - Sign in with your Google account
//     - Allow access to Google Drive
//     - Copy the authorization code from the browser
//     - Paste it in the terminal and press Enter
//     - A token.json file will be saved automatically
//     - Next time you run the server, it will use the saved token
//
// ============================================================

const express = require('express');
const cors = require('cors');
const multer = require('multer');
const { google } = require('googleapis');
const path = require('path');
const fs = require('fs');
const readline = require('readline');

// ============================================================
//  ⚙️  CONFIGURATION — Environment Variables
// ============================================================
//
//  Set these environment variables:
//
//  GOOGLE_CREDENTIALS  →  Full content of credentials.json as a string
//  GOOGLE_TOKEN        →  Full content of token.json as a string
//  MAIN_FOLDER_ID      →  Your Google Drive folder ID
//  PORT                →  Server port (default: 3000)
//
// ============================================================

const MAIN_FOLDER_ID = process.env.MAIN_FOLDER_ID || '1kiOA2WmSuc2HVhzEaQnTIP29pD1h5swX';
const PORT = process.env.PORT || 3000;
const SCOPES = ['https://www.googleapis.com/auth/drive'];

// ============================================================
//  🔐  OAuth2 Authentication (from Environment Variables)
// ============================================================

async function authenticate() {
  // --- Step 1: Read credentials from GOOGLE_CREDENTIALS env var ---
  const credentialsEnv = require("./credentials.json");

  if (!credentialsEnv) {
    console.error('');
    console.error('❌  خطأ: متغير البيئة GOOGLE_CREDENTIALS غير موجود!');
    console.error('');
    console.error('   يرجى تعيين GOOGLE_CREDENTIALS بمحتوى ملف credentials.json');
    console.error('');
    console.error('   مثال:');
    console.error('   GOOGLE_CREDENTIALS=\'{"installed":{"client_id":"...","client_secret":"...","redirect_uris":["..."]}}\'');
    console.error('');
    process.exit(1);
  }

  let credentialsFile;

  if (process.env.GOOGLE_CREDENTIALS) {
    // Render (production)
    try {
      credentialsFile = JSON.parse(process.env.GOOGLE_CREDENTIALS);
    } catch (e) {
      console.error('❌  فشل في قراءة GOOGLE_CREDENTIALS');
      process.exit(1);
    }
  } else {
    // Local (your case now)
    credentialsFile = require("./credentials.json");
  }

  const credentials = credentialsFile.installed || credentialsFile.web;

  if (!credentials) {
    console.error('❌  GOOGLE_CREDENTIALS غير صالح!');
    console.error('   تأكد أنه ملف OAuth2 وليس Service Account.');
    process.exit(1);
  }

  // --- Step 2: Create OAuth2 client ---
  const { client_id, client_secret, redirect_uris } = credentials;
  const oAuth2Client = new google.auth.OAuth2(
    client_id,
    client_secret,
    redirect_uris[0]
  );

  // --- Step 3: Check if token exists in GOOGLE_TOKEN env var ---
  const tokenEnv = process.env.GOOGLE_TOKEN;

  if (tokenEnv) {
    console.log('🔑  تم العثور على GOOGLE_TOKEN — جاري تحميل التوكن...');
    let token;
    try {
      token = JSON.parse(tokenEnv);
    } catch (e) {
      console.error('❌  فشل في قراءة GOOGLE_TOKEN — تأكد أنه JSON صالح');
      process.exit(1);
    }

    oAuth2Client.setCredentials(token);

    // Log refreshed tokens so the user can update the env var
    oAuth2Client.on('tokens', (newTokens) => {
      const updatedToken = { ...token, ...newTokens };
      token = updatedToken;
      console.log('🔄  تم تحديث التوكن تلقائياً');
      console.log('   📋  قم بتحديث GOOGLE_TOKEN بهذه القيمة:');
      console.log(`   ${JSON.stringify(updatedToken)}`);
    });

    console.log('✅  تم تسجيل الدخول بنجاح');
    return oAuth2Client;
  }

  // --- Step 4: No token — first time authorization ---
  console.log('');
  console.log('═══════════════════════════════════════════════════════');
  console.log('  🔐  مطلوب تسجيل الدخول لأول مرة');
  console.log('═══════════════════════════════════════════════════════');
  console.log('');

  const authUrl = oAuth2Client.generateAuthUrl({
    access_type: 'offline',
    scope: SCOPES,
    prompt: 'consent',
  });

  console.log('  1️⃣  افتح هذا الرابط في المتصفح:');
  console.log('');
  console.log(`     ${authUrl}`);
  console.log('');
  console.log('  2️⃣  سجّل الدخول بحساب Google الخاص بك');
  console.log('  3️⃣  اسمح بالوصول إلى Google Drive');
  console.log('  4️⃣  انسخ كود التفويض من المتصفح');
  console.log('  5️⃣  الصقه هنا واضغط Enter:');
  console.log('');

  const code = await askQuestion('     📋  كود التفويض: ');

  if (!code || !code.trim()) {
    console.error('❌  لم يتم إدخال كود التفويض!');
    process.exit(1);
  }

  // --- Step 5: Exchange code for tokens ---
  try {
    const { tokens } = await oAuth2Client.getToken(code.trim());
    oAuth2Client.setCredentials(tokens);

    console.log('');
    console.log('✅  تم تسجيل الدخول بنجاح!');
    console.log('');
    console.log('   📋  عيّن هذا كمتغير بيئة GOOGLE_TOKEN:');
    console.log(`   ${JSON.stringify(tokens)}`);
    console.log('');

    oAuth2Client.on('tokens', (newTokens) => {
      const updatedToken = { ...tokens, ...newTokens };
      console.log('🔄  تم تحديث التوكن تلقائياً');
      console.log(`   📋  GOOGLE_TOKEN الجديد: ${JSON.stringify(updatedToken)}`);
    });

    return oAuth2Client;
  } catch (err) {
    console.error('');
    console.error('❌  فشل في استخدام كود التفويض:', err.message);
    console.error('   تأكد أن الكود صحيح ولم يُستخدم من قبل.');
    console.error('   أعد تشغيل الخادم وحاول مرة أخرى.');
    process.exit(1);
  }
}

/**
 * Helper: asks a question in the terminal and returns the answer
 */
function askQuestion(question) {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      rl.close();
      resolve(answer);
    });
  });
}

// ============================================================
//  📦  Express App Setup
// ============================================================

const app = express();

// Enable CORS so the frontend (running on a different port) can call this API
app.use(cors());

// Serve frontend static files from parent directory
app.use(express.static(path.join(__dirname, '..')));

// Parse JSON request bodies
app.use(express.json());

// Configure multer to store uploaded files temporarily in an "uploads" folder
const uploadsDir = path.join(__dirname, 'uploads');
if (!fs.existsSync(uploadsDir)) {
  fs.mkdirSync(uploadsDir);
}

const upload = multer({
  storage: multer.diskStorage({
    // Save files to the "uploads" folder temporarily
    destination: (req, file, cb) => {
      cb(null, uploadsDir);
    },
    // Keep the original filename with a timestamp to avoid collisions
    filename: (req, file, cb) => {
      const uniqueName = `${Date.now()}-${file.originalname}`;
      cb(null, uniqueName);
    },
  }),
});

// This will hold our Google Drive client after authentication
let drive;

// ============================================================
//  📂  GET /folders — Read Google Drive folder tree
// ============================================================
//
//  Response format:
//  [
//    {
//      "id": "...",
//      "name": "مادة الرياضيات",
//      "type": "folder",
//      "children": [ ... ]
//    }
//  ]
//
app.get('/folders', async (req, res) => {
  try {
    console.log('📂  جاري قراءة المجلدات من Google Drive...');

    const tree = await readFolderRecursive(MAIN_FOLDER_ID);

    console.log(`✅  تم تحميل ${countItems(tree)} عنصر`);
    res.json(tree);
  } catch (error) {
    console.error('❌  خطأ في قراءة المجلدات:', error.message);
    res.status(500).json({
      error: 'فشل في قراءة المجلدات',
      message: error.message,
    });
  }
});

/**
 * Reads all items inside a Google Drive folder recursively.
 */
async function readFolderRecursive(folderId) {
  const items = [];
  let pageToken = null;

  do {
    const response = await drive.files.list({
      q: `'${folderId}' in parents and trashed = false`,
      fields: 'nextPageToken, files(id, name, mimeType, size, webViewLink, createdTime, description)',
      orderBy: 'folder, name',
      pageSize: 100,
      pageToken: pageToken,
    });

    for (const file of response.data.files) {
      const isFolder = file.mimeType === 'application/vnd.google-apps.folder';

      if (isFolder) {
        const children = await readFolderRecursive(file.id);
        items.push({
          id: file.id,
          name: file.name,
          type: 'folder',
          children: children,
        });
      } else {
        items.push({
          id: file.id,
          name: file.name,
          type: 'file',
          mimeType: file.mimeType,
          size: parseInt(file.size || '0', 10),
          description: file.description || '',
          webViewLink: file.webViewLink || null,
          createdTime: file.createdTime,
        });
      }
    }

    pageToken = response.data.nextPageToken;
  } while (pageToken);

  return items;
}

/**
 * Counts total items in the tree (for logging)
 */
function countItems(tree) {
  let count = 0;
  for (const item of tree) {
    count++;
    if (item.children) {
      count += countItems(item.children);
    }
  }
  return count;
}

// ============================================================
//  🕐  GET /recent — Recently uploaded files
// ============================================================
//
//  Returns the 20 most recently created non-folder files under
//  MAIN_FOLDER_ID, ordered newest-first. Each item includes
//  the resolved folder path and parsed uploader name.
//
app.get('/recent', async (req, res) => {
  try {
    console.log('🕐  جاري جلب الملفات الأخيرة...');

    // Query all non-folder files, ordered by creation time desc
    const response = await drive.files.list({
      q: `mimeType != 'application/vnd.google-apps.folder' and trashed = false`,
      fields: 'files(id, name, mimeType, size, webViewLink, createdTime, description, parents)',
      orderBy: 'createdTime desc',
      pageSize: 50,
      spaces: 'drive',
    });

    const files = response.data.files || [];

    // Resolve path for each file and filter to those under MAIN_FOLDER_ID
    const recentFiles = [];

    for (const file of files) {
      if (recentFiles.length >= 20) break;

      const parentId = file.parents ? file.parents[0] : null;
      if (!parentId) continue;

      // Walk up the parent chain to check ancestry & build path
      const pathParts = [];
      let currentId = parentId;
      let isUnderMain = false;

      for (let depth = 0; depth < 20; depth++) {
        if (currentId === MAIN_FOLDER_ID) {
          isUnderMain = true;
          break;
        }
        try {
          const parent = await drive.files.get({
            fileId: currentId,
            fields: 'id, name, parents',
          });
          pathParts.unshift(parent.data.name);
          currentId = parent.data.parents ? parent.data.parents[0] : null;
          if (!currentId) break;
        } catch {
          break;
        }
      }

      if (!isUnderMain) continue;

      // Parse uploader from description
      let uploaderName = '';
      if (file.description) {
        const lines = file.description.split('\n');
        if (lines[0] && lines[0].startsWith('Uploader: ')) {
          uploaderName = lines[0].replace('Uploader: ', '');
        }
      }

      recentFiles.push({
        id: file.id,
        name: file.name,
        mimeType: file.mimeType,
        size: parseInt(file.size || '0', 10),
        webViewLink: file.webViewLink || null,
        createdTime: file.createdTime,
        uploaderName: uploaderName,
        path: pathParts.join(' / ') || 'الرئيسية',
      });
    }

    console.log(`✅  تم جلب ${recentFiles.length} ملف(ات) حديثة`);
    res.json(recentFiles);
  } catch (error) {
    console.error('❌  خطأ في جلب الملفات الأخيرة:', error.message);
    res.status(500).json({
      error: 'فشل في جلب الملفات الأخيرة',
      message: error.message,
    });
  }
});

// ============================================================
//  📤  POST /upload — Upload files to Google Drive
// ============================================================
//
//  Accepts multipart form:
//    - name:        (required) Name to add to each file
//    - description: (optional) Description
//    - folderId:    (optional) Target folder ID
//    - files:       (required) One or more files
//
//  File naming:  "originalname - name"
//
app.post('/upload', upload.array('files'), async (req, res) => {
  try {
    const { name, description, folderId } = req.body;
    const files = req.files;

    // --- Validation ---
    if (!name || !name.trim()) {
      return res.status(400).json({
        error: 'الاسم مطلوب',
        message: 'يرجى إدخال اسم للملفات',
      });
    }

    if (!files || files.length === 0) {
      return res.status(400).json({
        error: 'الملفات مطلوبة',
        message: 'يرجى اختيار ملف واحد على الأقل',
      });
    }

    const targetFolderId = folderId && folderId.trim() ? folderId.trim() : MAIN_FOLDER_ID;

    console.log(`📤  جاري رفع ${files.length} ملف(ات) إلى المجلد: ${targetFolderId}`);
    console.log(`   الاسم: ${name}`);
    if (description) console.log(`   الوصف: ${description}`);

    const uploadedFiles = [];

    for (const file of files) {
      console.log(`   ⬆️  رفع: ${file.originalname}`);

      // Build the description field: uploader name + optional description
      let driveDescription = `Uploader: ${name.trim()}`;
      if (description && description.trim()) {
        driveDescription += `\n${description.trim()}`;
      }

      const fileMetadata = {
        name: file.originalname,
        parents: [targetFolderId],
        description: driveDescription,
      };

      const driveResponse = await drive.files.create({
        requestBody: fileMetadata,
        media: {
          mimeType: file.mimetype,
          body: fs.createReadStream(file.path),
        },
        fields: 'id, name, webViewLink',
      });

      uploadedFiles.push({
        id: driveResponse.data.id,
        name: driveResponse.data.name,
        webViewLink: driveResponse.data.webViewLink,
      });

      // Delete temporary file
      fs.unlink(file.path, (err) => {
        if (err) console.warn(`⚠️  تعذّر حذف الملف المؤقت: ${file.path}`);
      });
    }

    console.log(`✅  تم رفع ${uploadedFiles.length} ملف(ات) بنجاح`);

    res.json({
      success: true,
      message: `تم رفع ${uploadedFiles.length} ملف(ات) بنجاح`,
      files: uploadedFiles,
    });
  } catch (error) {
    console.error('❌  خطأ في رفع الملفات:', error.message);

    if (req.files) {
      req.files.forEach((file) => {
        fs.unlink(file.path, () => { });
      });
    }

    res.status(500).json({
      error: 'فشل في رفع الملفات',
      message: error.message,
    });
  }
});

// ============================================================
//  🚀  Start the Server
// ============================================================
//
//  We authenticate FIRST, then start listening for requests.
//  This way, if auth fails, the server won't start.
//

async function startServer() {
  console.log('');
  console.log('🔄  جاري تسجيل الدخول...');

  // Authenticate with Google (will prompt on first run)
  const auth = await authenticate();

  // Create the Google Drive client with our authenticated credentials
  drive = google.drive({ version: 'v3', auth });

  // Start Express server
  app.listen(PORT, () => {
    console.log('');
    console.log('╔══════════════════════════════════════════════╗');
    console.log('║   مكتبة المواد الدراسية — الخادم يعمل! 🚀    ║');
    console.log('╚══════════════════════════════════════════════╝');
    console.log('');
    console.log(`   🌐  العنوان: http://localhost:${PORT}`);
    console.log(`   📂  GET  /folders  →  قراءة المجلدات`);
    console.log(`   📤  POST /upload   →  رفع الملفات`);
    console.log('');

    if (MAIN_FOLDER_ID === 'YOUR_FOLDER_ID_HERE') {
      console.warn('⚠️  تنبيه: لم يتم تعيين MAIN_FOLDER_ID بعد!');
      console.warn('   يرجى تعديل الملف server.js وإدخال معرّف المجلد الرئيسي');
      console.warn('');
    }
  });
}

// Run!
startServer();
