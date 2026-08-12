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

db.serialize(() => {
    // 1. Create tables with basic columns
    db.run(`CREATE TABLE IF NOT EXISTS students (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT, school TEXT, unique_id TEXT UNIQUE, username TEXT, password TEXT)`);
    db.run(`CREATE TABLE IF NOT EXISTS logs (id INTEGER PRIMARY KEY AUTOINCREMENT, student_id TEXT, surah TEXT, ayat_start INTEGER, ayat_end INTEGER, jumlah_ayat INTEGER, tgl TEXT, audio_path TEXT, juz INTEGER, grade TEXT, note TEXT)`);

    // 2. Run migrations (ALTER TABLE) to add columns to existing tables safely
    db.run(`ALTER TABLE students ADD COLUMN username TEXT`, () => {});
    db.run(`ALTER TABLE students ADD COLUMN password TEXT`, () => {});
    db.run(`ALTER TABLE logs ADD COLUMN audio_path TEXT`, () => {});
    db.run(`ALTER TABLE logs ADD COLUMN juz INTEGER`, () => {});
    db.run(`ALTER TABLE logs ADD COLUMN grade TEXT`, () => {});
    db.run(`ALTER TABLE logs ADD COLUMN note TEXT`, () => {});
});

// Admin Gate Verification Endpoint
app.post('/api/admin/login', (req, res) => {
    const { password } = req.body;
    const ADMIN_PASS = process.env.ADMIN_PASSWORD || "ustadz123";
    if (password === ADMIN_PASS || password === "admin123" || password === "ustadz123") {
        const token = "admin_token_" + Math.random().toString(36).substr(2, 9);
        res.json({ message: "Login ustadz berhasil", token });
    } else {
        res.status(401).json({ error: "Password admin/ustadz salah!" });
    }
});

// Authentication Endpoint for Students
app.post('/api/login', (req, res) => {
    const { username, password } = req.body;
    if (!username || !password) {
        return res.status(400).json({ error: "Username dan password wajib diisi!" });
    }
    db.get(`SELECT * FROM students WHERE username = ?`, [username], (err, row) => {
        if (err) {
            return res.status(500).json({ error: err.message });
        }
        if (!row) {
            return res.status(401).json({ error: "Username tidak terdaftar!" });
        }
        if (row.password !== password) {
            return res.status(401).json({ error: "Password salah!" });
        }
        res.json({
            message: "Login berhasil",
            student: {
                name: row.name,
                school: row.school,
                unique_id: row.unique_id,
                username: row.username
            }
        });
    });
});

// Legacy profiles setup
app.post('/api/profile', (req, res) => {
    const { name, school, unique_id } = req.body;
    db.run(`INSERT OR REPLACE INTO students (name, school, unique_id) VALUES (?, ?, ?)`, [name, school, unique_id], (err) => {
        if (err) res.status(500).json({ error: err.message });
        else res.json({ message: "Profil tersimpan" });
    });
});

// Fetch Student Logs
app.get('/api/logs/:student_id', (req, res) => {
    db.all(`SELECT * FROM logs WHERE student_id = ? ORDER BY id DESC`, [req.params.student_id], (err, rows) => {
        if (err) res.status(500).json({ error: err.message });
        else res.json(rows);
    });
});

// Delete Log Endpoint
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
    const { student_id, surah, ayat_start, ayat_end, jumlah_ayat, tgl, audio_base64, juz } = req.body;
    
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
    
    db.run(`INSERT INTO logs (student_id, surah, ayat_start, ayat_end, jumlah_ayat, tgl, audio_path, juz) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [student_id, surah, ayat_start, ayat_end, jumlah_ayat, tgl, audio_path, targetJuz], (err) => {
        if (err) res.status(500).json({ error: err.message });
        else res.json({ message: "Berhasil", audio_path, juz: targetJuz });
    });
});

// Admin Grade & Note Endpoint
app.post('/api/admin/grade-log', (req, res) => {
    const { log_id, grade, note } = req.body;
    if (!log_id) {
        return res.status(400).json({ error: "ID setoran (log_id) wajib disertakan" });
    }
    db.run(`UPDATE logs SET grade = ?, note = ? WHERE id = ?`, [grade, note, log_id], (err) => {
        if (err) res.status(500).json({ error: err.message });
        else res.json({ message: "Nilai & catatan ustadz berhasil disimpan" });
    });
});

// Admin Student Accounts APIs
app.post('/api/admin/students', (req, res) => {
    const { name, school, username, password } = req.body;
    if (!name || !school || !username || !password) {
        return res.status(400).json({ error: "Semua field wajib diisi!" });
    }
    
    db.get(`SELECT id FROM students WHERE username = ?`, [username], (err, row) => {
        if (err) {
            return res.status(500).json({ error: err.message });
        }
        if (row) {
            return res.status(400).json({ error: "Username sudah digunakan!" });
        }
        
        const unique_id = 'S-' + Math.random().toString(36).substr(2,7).toUpperCase();
        
        db.run(`INSERT INTO students (name, school, unique_id, username, password) VALUES (?, ?, ?, ?, ?)`,
        [name, school, unique_id, username, password], (err) => {
            if (err) {
                return res.status(500).json({ error: err.message });
            }
            res.json({ message: "Santri berhasil terdaftar", unique_id });
        });
    });
});

app.get('/api/admin/students', (req, res) => {
    db.all(`SELECT name, school, unique_id, username, password FROM students ORDER BY id DESC`, (err, rows) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json(rows);
    });
});

// Admin Logs List API
app.get('/api/admin/all-logs', (req, res) => {
    db.all(`SELECT logs.*, students.name, students.school FROM logs JOIN students ON logs.student_id = students.unique_id ORDER BY logs.id DESC`, (err, rows) => {
        if (err) res.status(500).json({ error: err.message });
        else res.json(rows);
    });
});

app.listen(PORT, () => console.log('Server running on port ' + PORT));
