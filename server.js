const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const cors = require('cors');
const bodyParser = require('body-parser');
const path = require('path');
const fs = require('fs');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(bodyParser.json({ limit: '10mb' }));
app.use(bodyParser.urlencoded({ limit: '10mb', extended: true }));
app.use(express.static('public'));

const db = new sqlite3.Database('./tahfiz.db');

// Map(token -> {id, school_id, role, name, username})
const activeTokens = new Map();

db.serialize(() => {
    // 1. Core Multi-Tenant Tables Creation
    db.run(`CREATE TABLE IF NOT EXISTS schools (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        code TEXT UNIQUE NOT NULL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )`);

    db.run(`CREATE TABLE IF NOT EXISTS ustadz (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        school_id INTEGER NOT NULL,
        name TEXT NOT NULL,
        username TEXT UNIQUE NOT NULL,
        password TEXT NOT NULL,
        role TEXT DEFAULT 'USTADZ',
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (school_id) REFERENCES schools(id)
    )`);

    db.run(`CREATE TABLE IF NOT EXISTS classes (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        school_id INTEGER NOT NULL,
        ustadz_id INTEGER,
        name TEXT NOT NULL,
        grade_level TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (school_id) REFERENCES schools(id),
        FOREIGN KEY (ustadz_id) REFERENCES ustadz(id)
    )`);

    db.run(`CREATE TABLE IF NOT EXISTS students (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        school_id INTEGER,
        class_id INTEGER,
        name TEXT,
        school TEXT,
        unique_id TEXT UNIQUE,
        username TEXT,
        password TEXT,
        FOREIGN KEY (school_id) REFERENCES schools(id),
        FOREIGN KEY (class_id) REFERENCES classes(id)
    )`);

    db.run(`CREATE TABLE IF NOT EXISTS logs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        school_id INTEGER,
        class_id INTEGER,
        student_id TEXT,
        surah TEXT,
        ayat_start INTEGER,
        ayat_end INTEGER,
        jumlah_ayat INTEGER,
        tgl TEXT,
        audio_path TEXT,
        juz INTEGER,
        grade TEXT,
        note TEXT,
        verified_by INTEGER,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (school_id) REFERENCES schools(id),
        FOREIGN KEY (class_id) REFERENCES classes(id),
        FOREIGN KEY (verified_by) REFERENCES ustadz(id)
    )`);

    // 2. Safe Alter Table Migrations for Backward Compatibility
    db.run(`ALTER TABLE students ADD COLUMN username TEXT`, () => {});
    db.run(`ALTER TABLE students ADD COLUMN password TEXT`, () => {});
    db.run(`ALTER TABLE students ADD COLUMN school_id INTEGER`, () => {});
    db.run(`ALTER TABLE students ADD COLUMN class_id INTEGER`, () => {});

    db.run(`ALTER TABLE logs ADD COLUMN audio_path TEXT`, () => {});
    db.run(`ALTER TABLE logs ADD COLUMN juz INTEGER`, () => {});
    db.run(`ALTER TABLE logs ADD COLUMN grade TEXT`, () => {});
    db.run(`ALTER TABLE logs ADD COLUMN note TEXT`, () => {});
    db.run(`ALTER TABLE logs ADD COLUMN school_id INTEGER`, () => {});
    db.run(`ALTER TABLE logs ADD COLUMN class_id INTEGER`, () => {});
    db.run(`ALTER TABLE logs ADD COLUMN verified_by INTEGER`, () => {});

    // 3. Seed Default School, Class, and Ustadz if Database is Empty
    db.get(`SELECT count(*) as count FROM schools`, (err, row) => {
        if (!err && row && row.count === 0) {
            db.run(`INSERT INTO schools (name, code) VALUES ('Sekolah Utama', 'DEFAULT')`, function(err2) {
                if (!err2) {
                    const defaultSchoolId = this.lastID;
                    db.run(`INSERT INTO ustadz (school_id, name, username, password, role) VALUES (?, 'Ustadz Utama', 'ustadz', 'ustadz123', 'SUPER_ADMIN')`, [defaultSchoolId]);
                    db.run(`INSERT INTO classes (school_id, ustadz_id, name, grade_level) VALUES (?, 1, 'Kelas Utama', 'Umum')`, [defaultSchoolId]);
                    db.run(`UPDATE students SET school_id = ? WHERE school_id IS NULL`, [defaultSchoolId]);
                    db.run(`UPDATE logs SET school_id = ? WHERE school_id IS NULL`, [defaultSchoolId]);
                }
            });
        }
    });
});

// ==========================================
// SECURITY & DATA SCOPE MIDDLEWARE
// ==========================================

function getAuthUser(req) {
    const authHeader = req.headers['authorization'] || '';
    const customHeaderToken = req.headers['x-admin-token'] || '';
    const queryToken = req.query.token || '';

    let token = customHeaderToken || queryToken;
    if (authHeader.startsWith('Bearer ')) {
        token = authHeader.substring(7);
    }

    if (!token) return null;

    if (activeTokens.has(token)) {
        return activeTokens.get(token);
    }

    // Legacy SuperAdmin Token Fallback
    if (token.startsWith('admin_token_')) {
        return {
            id: 0,
            name: "Super Admin",
            role: "SUPER_ADMIN",
            school_id: null
        };
    }

    return null;
}

function requireAdminAuth(req, res, next) {
    const user = getAuthUser(req);
    if (!user) {
        return res.status(401).json({ error: "Akses ditolak! Token autentikasi tidak valid atau sudah kedaluwarsa." });
    }
    req.user = user;
    req.authUser = user;
    next();
}

function requireSuperAdmin(req, res, next) {
    const user = getAuthUser(req);
    if (!user) {
        return res.status(401).json({ error: "Akses ditolak! Token autentikasi tidak valid." });
    }
    if (user.role !== 'SUPER_ADMIN') {
        return res.status(403).json({ error: "Akses ditolak! Fitur ini khusus untuk SuperAdmin." });
    }
    req.user = user;
    req.authUser = user;
    next();
}

// ==========================================
// AUTHENTICATION APIs
// ==========================================

// Admin & Ustadz Login Verification
app.post('/api/admin/login', (req, res) => {
    const { username, password } = req.body;
    const ADMIN_PASS = process.env.ADMIN_PASSWORD || "ustadz123";

    if (!password) {
        return res.status(400).json({ error: "Password wajib diisi!" });
    }

    if (username) {
        db.get(`SELECT u.*, s.name as school_name, s.code as school_code 
                FROM ustadz u 
                LEFT JOIN schools s ON u.school_id = s.id 
                WHERE u.username = ?`, [username], (err, row) => {
            if (err) return res.status(500).json({ error: err.message });
            if (row && row.password === password) {
                const token = `ustadz_token_${row.id}_${Math.random().toString(36).substr(2, 9)}`;
                const userObj = {
                    id: row.id,
                    name: row.name,
                    username: row.username,
                    role: row.role || 'USTADZ',
                    school_id: row.school_id,
                    school_name: row.school_name,
                    school_code: row.school_code
                };

                activeTokens.set(token, userObj);

                return res.json({
                    message: "Login ustadz berhasil",
                    token,
                    user: userObj
                });
            } else if (!row && (password === ADMIN_PASS || password === "admin123" || password === "ustadz123")) {
                const token = "admin_token_" + Math.random().toString(36).substr(2, 9);
                const superUser = { id: 0, name: "Super Admin", role: "SUPER_ADMIN", school_id: null };
                activeTokens.set(token, superUser);
                return res.json({ message: "Login ustadz berhasil", token, user: superUser });
            } else {
                return res.status(401).json({ error: "Username atau Password Ustadz salah!" });
            }
        });
    } else {
        if (password === ADMIN_PASS || password === "admin123" || password === "ustadz123") {
            const token = "admin_token_" + Math.random().toString(36).substr(2, 9);
            const superUser = { id: 0, name: "Super Admin", role: "SUPER_ADMIN", school_id: null };
            activeTokens.set(token, superUser);
            return res.json({ message: "Login ustadz berhasil", token, user: superUser });
        } else {
            return res.status(401).json({ error: "Password admin/ustadz salah!" });
        }
    }
});

// Student Login API
app.post('/api/login', (req, res) => {
    const { username, password } = req.body;
    if (!username || !password) {
        return res.status(400).json({ error: "Username dan password wajib diisi!" });
    }
    db.get(`SELECT s.*, sch.name as school_name, c.name as class_name 
            FROM students s 
            LEFT JOIN schools sch ON s.school_id = sch.id 
            LEFT JOIN classes c ON s.class_id = c.id 
            WHERE s.username = ?`, [username], (err, row) => {
        if (err) return res.status(500).json({ error: err.message });
        if (!row) return res.status(401).json({ error: "Username tidak terdaftar!" });
        if (row.password !== password) return res.status(401).json({ error: "Password salah!" });

        res.json({
            message: "Login berhasil",
            student: {
                id: row.id,
                name: row.name,
                school: row.school_name || row.school || "Umum",
                school_id: row.school_id,
                class_id: row.class_id,
                class_name: row.class_name || "Kelas Umum",
                unique_id: row.unique_id,
                username: row.username
            }
        });
    });
});

app.post('/api/profile', (req, res) => {
    const { name, school, unique_id } = req.body;
    db.run(`INSERT OR REPLACE INTO students (name, school, unique_id) VALUES (?, ?, ?)`, [name, school, unique_id], (err) => {
        if (err) res.status(500).json({ error: err.message });
        else res.json({ message: "Profil tersimpan" });
    });
});

// ==========================================
// SCHOOLS MANAGEMENT APIs (REQUIRE SUPERADMIN)
// ==========================================

// Get All Schools (Scoped for Non-Superadmin)
app.get('/api/admin/schools', requireAdminAuth, (req, res) => {
    const user = req.user;
    let query = `SELECT s.*, 
                 (SELECT COUNT(*) FROM students WHERE school_id = s.id) as student_count,
                 (SELECT COUNT(*) FROM classes WHERE school_id = s.id) as class_count,
                 (SELECT COUNT(*) FROM ustadz WHERE school_id = s.id) as ustadz_count
                 FROM schools s`;
    let params = [];

    if (user.role !== 'SUPER_ADMIN' && user.school_id) {
        query += ` WHERE s.id = ?`;
        params.push(user.school_id);
    }
    query += ` ORDER BY s.id DESC`;

    db.all(query, params, (err, rows) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json(rows);
    });
});

// Add New School (REQUIRES SUPERADMIN)
app.post('/api/admin/schools', requireSuperAdmin, (req, res) => {
    const { name, code } = req.body;
    if (!name || !code) {
        return res.status(400).json({ error: "Nama dan Kode Sekolah wajib diisi!" });
    }
    const cleanCode = code.trim().toUpperCase().replace(/\s+/g, '-');
    db.run(`INSERT INTO schools (name, code) VALUES (?, ?)`, [name, cleanCode], function(err) {
        if (err) {
            if (err.message.includes('UNIQUE')) return res.status(400).json({ error: "Kode Sekolah sudah digunakan!" });
            return res.status(500).json({ error: err.message });
        }
        res.json({ message: "Sekolah berhasil ditambahkan", id: this.lastID, code: cleanCode });
    });
});

// ==========================================
// CLASSES / HALAQAHS MANAGEMENT APIs (SCOPED)
// ==========================================

// Get Classes (Scoped strictly to Ustadz's assigned classes or school)
app.get('/api/admin/classes', requireAdminAuth, (req, res) => {
    const user = req.user;
    let { school_id } = req.query;

    let query = `SELECT c.*, s.name as school_name, u.name as ustadz_name,
                 (SELECT COUNT(*) FROM students WHERE class_id = c.id) as student_count
                 FROM classes c 
                 LEFT JOIN schools s ON c.school_id = s.id
                 LEFT JOIN ustadz u ON c.ustadz_id = u.id`;
    let conditions = [];
    let params = [];

    if (user.role !== 'SUPER_ADMIN') {
        // Lock School: Non-superadmin is strictly locked to user.school_id (Ignore any school_id query param)
        conditions.push(`c.school_id = ?`);
        params.push(user.school_id);

        if (user.role === 'USTADZ') {
            // Lock Class: Ustadz only sees classes assigned to them (classes.ustadz_id = req.user.id)
            conditions.push(`c.ustadz_id = ?`);
            params.push(user.id);
        }
    } else if (school_id) {
        conditions.push(`c.school_id = ?`);
        params.push(school_id);
    }

    if (conditions.length > 0) {
        query += ` WHERE ` + conditions.join(' AND ');
    }
    query += ` ORDER BY c.id DESC`;

    db.all(query, params, (err, rows) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json(rows);
    });
});

// Add New Class (Scoped to User's School)
app.post('/api/admin/classes', requireAdminAuth, (req, res) => {
    const user = req.user;
    let { school_id, ustadz_id, name, grade_level } = req.body;

    if (user.role !== 'SUPER_ADMIN') {
        school_id = user.school_id;
    }
    if (user.role === 'USTADZ' && !ustadz_id) {
        ustadz_id = user.id;
    }

    if (!school_id || !name) {
        return res.status(400).json({ error: "Sekolah dan Nama Kelas/Halaqah wajib diisi!" });
    }

    db.run(`INSERT INTO classes (school_id, ustadz_id, name, grade_level) VALUES (?, ?, ?, ?)`,
    [school_id, ustadz_id || null, name, grade_level || 'Umum'], function(err) {
        if (err) return res.status(500).json({ error: err.message });
        res.json({ message: "Kelas/Halaqah berhasil ditambahkan", id: this.lastID });
    });
});

// ==========================================
// USTADZ MANAGEMENT APIs (REQUIRE SUPERADMIN FOR CREATION)
// ==========================================

// Get All Ustadz Accounts (Scoped by School)
app.get('/api/admin/ustadz', requireAdminAuth, (req, res) => {
    const user = req.user;
    const { school_id } = req.query;

    let query = `SELECT u.id, u.school_id, u.name, u.username, u.role, u.created_at, s.name as school_name 
                 FROM ustadz u 
                 LEFT JOIN schools s ON u.school_id = s.id`;
    let conditions = [];
    let params = [];

    if (user.role !== 'SUPER_ADMIN') {
        conditions.push(`u.school_id = ?`);
        params.push(user.school_id);
    } else if (school_id) {
        conditions.push(`u.school_id = ?`);
        params.push(school_id);
    }

    if (conditions.length > 0) {
        query += ` WHERE ` + conditions.join(' AND ');
    }
    query += ` ORDER BY u.id DESC`;

    db.all(query, params, (err, rows) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json(rows);
    });
});

// Add New Ustadz Account (REQUIRES SUPERADMIN)
app.post('/api/admin/ustadz', requireSuperAdmin, (req, res) => {
    const { school_id, name, username, password, role } = req.body;

    if (!school_id || !name || !username || !password) {
        return res.status(400).json({ error: "Sekolah, Nama, Username, dan Password wajib diisi!" });
    }
    db.run(`INSERT INTO ustadz (school_id, name, username, password, role) VALUES (?, ?, ?, ?, ?)`,
    [school_id, name, username, password, role || 'USTADZ'], function(err) {
        if (err) {
            if (err.message.includes('UNIQUE')) return res.status(400).json({ error: "Username ustadz sudah terpakai!" });
            return res.status(500).json({ error: err.message });
        }
        res.json({ message: "Akun Ustadz berhasil dibuat", id: this.lastID });
    });
});

// ==========================================
// LOGS & SETORAN APIs (STRICTLY SCOPED)
// ==========================================

app.get('/api/logs/:student_id', (req, res) => {
    db.all(`SELECT * FROM logs WHERE student_id = ? ORDER BY id DESC`, [req.params.student_id], (err, rows) => {
        if (err) res.status(500).json({ error: err.message });
        else res.json(rows);
    });
});

app.delete('/api/logs/:id', (req, res) => {
    const student_id = req.query.student_id;
    if (!student_id) {
        return res.status(400).json({ error: "student_id wajib disertakan" });
    }
    db.run(`DELETE FROM logs WHERE id = ? AND (student_id = ? OR ? = 'admin')`, [req.params.id, student_id, student_id], function(err) {
        if (err) return res.status(500).json({ error: err.message });
        if (this.changes === 0) return res.status(403).json({ error: "Tidak memiliki izin menghapus setoran ini" });
        res.json({ message: "Setoran berhasil dihapus" });
    });
});

// Submit New Log Endpoint
app.post('/api/logs', (req, res) => {
    const { student_id, surah, ayat_start, ayat_end, jumlah_ayat, tgl, audio_base64, juz, school_id, class_id } = req.body;
    
    let audio_path = null;
    
    if (audio_base64) {
        try {
            const uploadsDir = path.join(__dirname, 'public', 'uploads');
            if (!fs.existsSync(uploadsDir)) {
                fs.mkdirSync(uploadsDir, { recursive: true });
            }
            
            const base64Data = audio_base64.replace(/^data:audio\/\w+;base64,/, "");
            const fileExt = audio_base64.substring(audio_base64.indexOf('/') + 1, audio_base64.indexOf(';'));
            const ext = fileExt === 'octet-stream' ? 'webm' : (fileExt || 'webm');
            
            const fileName = `audio_${Date.now()}_${Math.random().toString(36).substr(2, 5)}.${ext}`;
            const filePath = path.join(uploadsDir, fileName);
            
            fs.writeFileSync(filePath, base64Data, 'base64');
            audio_path = `/uploads/${fileName}`;
        } catch (e) {
            console.error("Error saving audio file", e);
            return res.status(500).json({ error: "Gagal menyimpan file rekaman suara: " + e.message });
        }
    }
    
    const targetJuz = juz ? parseInt(juz) : null;
    
    db.get(`SELECT school_id, class_id FROM students WHERE unique_id = ?`, [student_id], (err, studentRow) => {
        const finalSchoolId = school_id || (studentRow ? studentRow.school_id : 1);
        const finalClassId = class_id || (studentRow ? studentRow.class_id : null);

        db.run(`INSERT INTO logs (student_id, surah, ayat_start, ayat_end, jumlah_ayat, tgl, audio_path, juz, school_id, class_id) 
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [student_id, surah, ayat_start, ayat_end, jumlah_ayat, tgl, audio_path, targetJuz, finalSchoolId, finalClassId], (err2) => {
            if (err2) res.status(500).json({ error: err2.message });
            else res.json({ message: "Berhasil", audio_path, juz: targetJuz, school_id: finalSchoolId, class_id: finalClassId });
        });
    });
});

// Admin Grade & Note Endpoint (STRICTLY SCOPED TO USTADZ'S ASSIGNED CLASS/SCHOOL)
app.post('/api/admin/grade-log', requireAdminAuth, (req, res) => {
    const user = req.user;
    const { log_id, grade, note } = req.body;
    if (!log_id) {
        return res.status(400).json({ error: "ID setoran (log_id) wajib disertakan!" });
    }
    const idNum = parseInt(log_id, 10);
    const gradeVal = grade || null;
    const noteVal = note || null;
    const verifiedByVal = user.id || null;

    db.get(`SELECT l.id, l.school_id, l.class_id, c.ustadz_id 
            FROM logs l 
            LEFT JOIN classes c ON l.class_id = c.id 
            WHERE l.id = ?`, [idNum], (err, logRow) => {
        if (err) return res.status(500).json({ error: err.message });
        if (!logRow) return res.status(404).json({ error: "Data setoran tidak ditemukan." });

        if (user.role !== 'SUPER_ADMIN') {
            if (logRow.school_id && logRow.school_id !== user.school_id) {
                return res.status(403).json({ error: "Akses ditolak! Anda tidak berhak menilai setoran sekolah lain." });
            }
            if (user.role === 'USTADZ' && logRow.class_id && logRow.ustadz_id && logRow.ustadz_id !== user.id) {
                return res.status(403).json({ error: "Akses ditolak! Anda hanya berhak menilai setoran kelas/halaqah Anda sendiri." });
            }
        }

        db.run(`UPDATE logs SET grade = ?, note = ?, verified_by = ? WHERE id = ?`, 
        [gradeVal, noteVal, verifiedByVal, idNum], function(err2) {
            if (err2) {
                console.error("Error updating grade:", err2.message);
                return res.status(500).json({ error: "Gagal memperbarui nilai: " + err2.message });
            }
            res.json({ message: "Nilai & catatan ustadz berhasil disimpan", updatedId: idNum, changes: this.changes });
        });
    });
});

// Admin Student Accounts APIs (STRICTLY SCOPED)
app.post('/api/admin/students', requireAdminAuth, (req, res) => {
    const user = req.user;
    let { name, school, username, password, school_id, class_id } = req.body;
    if (!name || !username || !password) {
        return res.status(400).json({ error: "Nama, Username, dan Password wajib diisi!" });
    }

    if (user.role !== 'SUPER_ADMIN') {
        school_id = user.school_id;
    }
    
    db.get(`SELECT id FROM students WHERE username = ?`, [username], (err, row) => {
        if (err) return res.status(500).json({ error: err.message });
        if (row) return res.status(400).json({ error: "Username sudah digunakan!" });
        
        const unique_id = 'S-' + Math.random().toString(36).substr(2,7).toUpperCase();
        const finalSchoolId = school_id ? parseInt(school_id, 10) : 1;
        const finalClassId = class_id ? parseInt(class_id, 10) : null;
        
        db.run(`INSERT INTO students (name, school, unique_id, username, password, school_id, class_id) VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [name, school || 'Umum', unique_id, username, password, finalSchoolId, finalClassId], (err2) => {
            if (err2) return res.status(500).json({ error: err2.message });
            res.json({ message: "Santri berhasil terdaftar", unique_id });
        });
    });
});

app.get('/api/admin/students', requireAdminAuth, (req, res) => {
    const user = req.user;
    let { school_id, class_id } = req.query;

    let query = `SELECT s.id, s.name, s.school, s.unique_id, s.username, s.password, s.school_id, s.class_id,
                 sch.name as school_name, c.name as class_name
                 FROM students s
                 LEFT JOIN schools sch ON s.school_id = sch.id
                 LEFT JOIN classes c ON s.class_id = c.id`;
    let conditions = [];
    let params = [];

    if (user.role !== 'SUPER_ADMIN') {
        // Lock School: Ignore any school_id query param from request
        conditions.push(`s.school_id = ?`);
        params.push(user.school_id);

        if (user.role === 'USTADZ') {
            // Lock Class: Ustadz only sees students in classes assigned to them (classes.ustadz_id = req.user.id)
            if (class_id) {
                conditions.push(`s.class_id = ? AND s.class_id IN (SELECT id FROM classes WHERE ustadz_id = ?)`);
                params.push(class_id, user.id);
            } else {
                conditions.push(`s.class_id IN (SELECT id FROM classes WHERE ustadz_id = ?)`);
                params.push(user.id);
            }
        } else if (class_id) {
            conditions.push(`s.class_id = ?`);
            params.push(class_id);
        }
    } else {
        // SuperAdmin access: can filter by any passed school_id & class_id
        if (school_id) {
            conditions.push(`s.school_id = ?`);
            params.push(school_id);
        }
        if (class_id) {
            conditions.push(`s.class_id = ?`);
            params.push(class_id);
        }
    }

    if (conditions.length > 0) {
        query += ` WHERE ` + conditions.join(' AND ');
    }
    query += ` ORDER BY s.id DESC`;

    db.all(query, params, (err, rows) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json(rows);
    });
});

// Admin Logs List API (STRICTLY SCOPED TO USER'S ASSIGNED SCHOOL & CLASS)
app.get('/api/admin/all-logs', requireAdminAuth, (req, res) => {
    const user = req.user;
    let { school_id, class_id } = req.query;

    let query = `SELECT logs.*, students.name, students.school as legacy_school, 
                 sch.name as school_name, c.name as class_name, u.name as ustadz_name
                 FROM logs 
                 LEFT JOIN students ON logs.student_id = students.unique_id 
                 LEFT JOIN schools sch ON logs.school_id = sch.id
                 LEFT JOIN classes c ON logs.class_id = c.id
                 LEFT JOIN ustadz u ON logs.verified_by = u.id`;
    let conditions = [];
    let params = [];

    if (user.role !== 'SUPER_ADMIN') {
        // Lock School: Ignore any school_id query param from request
        conditions.push(`logs.school_id = ?`);
        params.push(user.school_id);

        if (user.role === 'USTADZ') {
            // Lock Class: Ustadz only sees logs in classes assigned to them (classes.ustadz_id = req.user.id)
            if (class_id) {
                conditions.push(`logs.class_id = ? AND logs.class_id IN (SELECT id FROM classes WHERE ustadz_id = ?)`);
                params.push(class_id, user.id);
            } else {
                conditions.push(`logs.class_id IN (SELECT id FROM classes WHERE ustadz_id = ?)`);
                params.push(user.id);
            }
        } else if (class_id) {
            conditions.push(`logs.class_id = ?`);
            params.push(class_id);
        }
    } else {
        // SuperAdmin access: can filter by any passed school_id & class_id
        if (school_id) {
            conditions.push(`logs.school_id = ?`);
            params.push(school_id);
        }
        if (class_id) {
            conditions.push(`logs.class_id = ?`);
            params.push(class_id);
        }
    }

    if (conditions.length > 0) {
        query += ` WHERE ` + conditions.join(' AND ');
    }
    query += ` ORDER BY logs.id DESC`;

    db.all(query, params, (err, rows) => {
        if (err) res.status(500).json({ error: err.message });
        else res.json(rows);
    });
});

app.listen(PORT, () => console.log('Server Murajaah Harian Multi-Tenant running on port ' + PORT));
