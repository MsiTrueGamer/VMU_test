
import express, { Request, Response, NextFunction } from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import mysql from 'mysql2/promise';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import { TeamMember, NewsArticle, BlogPost, GalleryEvent, AdminUser, ApplicationForm, AdminRole } from './types';


// Load environment variables from .env.local file
dotenv.config({ path: path.resolve(__dirname, '.env.local') });

// __dirname is available globally in CommonJS modules (which this project is configured to use).
// The manual 'Fix for __dirname' using import.meta.url is for ES Modules and was causing the error.

// Ensure uploads directory exists
const uploadDir = 'uploads';
if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir);
}

// --- MAIN SETUP ---
const app = express();
app.use(cors());
app.use(express.json());
app.use('/uploads', express.static(path.join(__dirname, 'uploads'))); // Serve static files from uploads

// --- DATABASE CONNECTION & SETUP ---
let pool: mysql.Pool;

async function initializeDatabase() {
    pool = mysql.createPool({
        host: process.env.DB_HOST,
        user: process.env.DB_USER,
        password: process.env.DB_PASSWORD,
        database: process.env.DB_DATABASE,
        waitForConnections: true,
        connectionLimit: 10,
        queueLimit: 0
    });
    
    // Test the connection before proceeding
    const connection = await pool.getConnection();
    connection.release(); // Release the connection back to the pool
    console.log('Connected to MySQL database.');

    // On startup, check for superadmin and create if not exists
    const [rows] = await pool.execute('SELECT * FROM users WHERE is_superadmin = ?', [true]);
    const superAdmins = rows as any[];
    if (superAdmins.length === 0) {
        console.log('No superadmin found. Creating one...');
        const email = process.env.SUPERADMIN_EMAIL || 'superadmin@example.com';
        const password = process.env.SUPERADMIN_PASSWORD || 'password123';
        const hashedPassword = await bcrypt.hash(password, 10);
        await pool.execute('INSERT INTO users (email, password_hash, is_superadmin) VALUES (?, ?, ?)', [email, hashedPassword, true]);
        console.log(`Superadmin created with email: ${email}`);
    }
}


// --- AUTHENTICATION ---
const JWT_SECRET = process.env.JWT_SECRET || 'your_default_secret';

type AuthRequest = Request & {
  user?: AdminUser;
};

const authMiddleware = (req: AuthRequest, res: Response, next: NextFunction) => {
    const token = req.headers.authorization?.split(' ')[1];
    if (!token) {
        return res.status(401).send('Access denied. No token provided.');
    }
    try {
        const decoded = jwt.verify(token, JWT_SECRET) as AdminUser;
        req.user = decoded;
        next();
    } catch (ex) {
        res.status(400).send('Invalid token.');
    }
};

const superadminMiddleware = (req: AuthRequest, res: Response, next: NextFunction) => {
    if (req.user?.role !== AdminRole.SUPERADMIN) {
        return res.status(403).send('Forbidden. Superadmin access required.');
    }
    next();
};

// --- FILE UPLOADS (Multer) ---
const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        cb(null, uploadDir + '/');
    },
    filename: (req, file, cb) => {
        cb(null, `${Date.now()}-${file.originalname}`);
    }
});
const upload = multer({ storage });


// --- API ROUTES ---

// AUTH
app.post('/api/login', async (req: Request, res: Response) => {
    const { email, password } = req.body;
    const [rows] = await pool.execute('SELECT * FROM users WHERE email = ?', [email]);
    const users = rows as any[];
    if (users.length === 0) return res.status(400).send('Invalid email or password.');
    
    const user = users[0];
    const validPassword = await bcrypt.compare(password, user.password_hash);
    if (!validPassword) return res.status(400).send('Invalid email or password.');

    // Get club and role info
    const role = user.is_superadmin ? AdminRole.SUPERADMIN : AdminRole.ADMIN;
    let clubId = '*';
    if(role === AdminRole.ADMIN) {
        const [adminRows] = await pool.execute('SELECT club_id FROM club_admins WHERE user_id = ?', [user.id]);
        const adminData = adminRows as any[];
        if(adminData.length > 0) clubId = adminData[0].club_id;
    }

    const userPayload: AdminUser = { id: user.id, email: user.email, role, clubId };
    const token = jwt.sign(userPayload, JWT_SECRET);

    res.json({ user: userPayload, token });
});

// TEAM
app.get('/api/clubs/:clubId/team', async (req: Request, res: Response) => {
    const { clubId } = req.params;
    const [members] = await pool.execute('SELECT * FROM team_members WHERE club_id = ?', [clubId]);
    res.json(members);
});
app.post('/api/clubs/:clubId/team', authMiddleware, upload.single('photo'), async (req: Request, res: Response) => {
    const { clubId } = req.params;
    const { name, role, grade, bio } = req.body;
    const photoUrl = req.file ? `/uploads/${req.file.filename}` : null;
    const [result] = await pool.execute('INSERT INTO team_members (club_id, name, role, grade, bio, photo_url) VALUES (?, ?, ?, ?, ?, ?)', [clubId, name, role, grade, bio, photoUrl]);
    const insertResult = result as mysql.ResultSetHeader;
    res.status(201).json({ id: insertResult.insertId, ...req.body, photoUrl });
});
app.put('/api/team/:memberId', authMiddleware, upload.single('photo'), async (req: Request, res: Response) => {
    const { memberId } = req.params;
    const { name, role, grade, bio } = req.body;
    let photoUrl = req.body.photoUrl; // Keep existing photo if not updated
    if (req.file) {
        photoUrl = `/uploads/${req.file.filename}`;
    }
    await pool.execute('UPDATE team_members SET name = ?, role = ?, grade = ?, bio = ?, photo_url = ? WHERE id = ?', [name, role, grade, bio, photoUrl, memberId]);
    res.json({ id: memberId, ...req.body, photoUrl });
});
app.delete('/api/team/:memberId', authMiddleware, async (req: Request, res: Response) => {
    const { memberId } = req.params;
    await pool.execute('DELETE FROM team_members WHERE id = ?', [memberId]);
    res.status(204).send();
});


// GALLERY
app.get('/api/clubs/:clubId/gallery', async(req: Request, res: Response) => {
    const { clubId } = req.params;
    const [events] = await pool.execute('SELECT * FROM gallery_events WHERE club_id = ?', [clubId]);
    res.json(events);
});
app.post('/api/clubs/:clubId/gallery', authMiddleware, upload.array('images', 10), async(req: Request, res: Response) => {
    const { clubId } = req.params;
    const { title } = req.body;
    const files = req.files as Express.Multer.File[];
    const imageUrls = files.map(f => `/uploads/${f.filename}`);
    const [result] = await pool.execute('INSERT INTO gallery_events (club_id, title, images) VALUES (?, ?, ?)', [clubId, title, JSON.stringify(imageUrls)]);
    const insertResult = result as mysql.ResultSetHeader;
    res.status(201).json({ id: insertResult.insertId, title, images: imageUrls });
});

// NEWS
app.get('/api/clubs/:clubId/news', async(req: Request, res: Response) => {
    const { clubId } = req.params;
    const [articles] = await pool.execute('SELECT * FROM news_articles WHERE club_id = ? ORDER BY created_at DESC', [clubId]);
    res.json(articles);
});
app.post('/api/clubs/:clubId/news', authMiddleware, upload.single('image'), async(req: Request, res: Response) => {
    const { clubId } = req.params;
    const { title, author, content } = req.body;
    const imageUrl = req.file ? `/uploads/${req.file.filename}` : null;
    const [result] = await pool.execute('INSERT INTO news_articles (club_id, title, author, content, image_url) VALUES (?, ?, ?, ?, ?)', [clubId, title, author, content, imageUrl]);
    const insertResult = result as mysql.ResultSetHeader;
    const [newArticle] = await pool.execute('SELECT * FROM news_articles WHERE id = ?', [insertResult.insertId]);
    res.status(201).json((newArticle as any)[0]);
});

// BLOGS
app.get('/api/clubs/:clubId/blogs', async(req: Request, res: Response) => {
    const { clubId } = req.params;
    const [posts] = await pool.execute('SELECT * FROM blog_posts WHERE club_id = ? ORDER BY created_at DESC', [clubId]);
    res.json(posts);
});
app.post('/api/clubs/:clubId/blogs', authMiddleware, upload.single('image'), async(req: Request, res: Response) => {
    const { clubId } = req.params;
    const { title, author, excerpt, content } = req.body;
    const imageUrl = req.file ? `/uploads/${req.file.filename}` : null;
    const [result] = await pool.execute('INSERT INTO blog_posts (club_id, title, author, excerpt, content, image_url) VALUES (?, ?, ?, ?, ?, ?)', [clubId, title, author, excerpt, content, imageUrl]);
    const insertResult = result as mysql.ResultSetHeader;
    const [newPost] = await pool.execute('SELECT * FROM blog_posts WHERE id = ?', [insertResult.insertId]);
    res.status(201).json((newPost as any)[0]);
});

// ADMINS (Superadmin only)
app.get('/api/admins', authMiddleware, superadminMiddleware, async(req: AuthRequest, res: Response) => {
    const [users] = await pool.execute('SELECT u.id, u.email, u.is_superadmin, ca.club_id FROM users u LEFT JOIN club_admins ca ON u.id = ca.user_id');
    const admins = (users as any[]).map(u => ({
        id: u.id,
        email: u.email,
        role: u.is_superadmin ? AdminRole.SUPERADMIN : AdminRole.ADMIN,
        clubId: u.club_id || '*'
    }));
    res.json(admins);
});
app.post('/api/admins', authMiddleware, superadminMiddleware, async(req: AuthRequest, res: Response) => {
    const { email, clubId } = req.body; // clubId is for regular admins
    const tempPassword = 'password123'; // Default password, user should change it
    const hashedPassword = await bcrypt.hash(tempPassword, 10);
    
    const [userResult] = await pool.execute('INSERT INTO users (email, password_hash, is_superadmin) VALUES (?, ?, ?)', [email, hashedPassword, false]);
    const newUserId = (userResult as mysql.ResultSetHeader).insertId;
    await pool.execute('INSERT INTO club_admins (user_id, club_id, role) VALUES (?, ?, ?)', [newUserId, clubId, 'ADMIN']);

    res.status(201).json({ id: newUserId, email, role: AdminRole.ADMIN, clubId });
});
app.delete('/api/admins/:adminId', authMiddleware, superadminMiddleware, async(req: AuthRequest, res: Response) => {
    const { adminId } = req.params;
    await pool.execute('DELETE FROM users WHERE id = ? AND is_superadmin = FALSE', [adminId]); // Also deletes from club_admins via CASCADE
    res.status(204).send();
});


// DOWNLOADS
app.get('/api/clubs/:clubId/application', async(req: Request, res: Response) => {
    const { clubId } = req.params;
    const [rows] = await pool.execute('SELECT * FROM application_forms ORDER BY updatedAt DESC LIMIT 1');
    const forms = rows as any[];
    if (forms.length === 0) return res.status(404).send('Application form not found.');
    res.json(forms[0]);
});
app.put('/api/application', authMiddleware, upload.single('file'), async(req: Request, res: Response) => {
    if (!req.file) return res.status(400).send('No file uploaded.');
    const { filename, originalname } = req.file;
    const url = `/uploads/${filename}`;
    await pool.execute('INSERT INTO application_forms (url, fileName, updatedAt) VALUES (?, ?, ?)', [url, originalname, new Date()]);
    res.json({ url, fileName: originalname, updatedAt: new Date().toISOString() });
});

// --- SERVER START ---
async function startServer() {
    try {
        await initializeDatabase();
        const PORT = process.env.PORT || 4000;
        app.listen(PORT, () => {
          console.log(`Server running on http://localhost:${PORT}`);
        });
    } catch (err) {
        console.error('Failed to start server:', err);
        process.exit(1);
    }
}

startServer();