const express = require('express');
const bodyParser = require('body-parser');
const cors = require('cors');
const { Client } = require('pg');
const fs = require('fs');
const path = require('path');

const app = express();
const PORT = 5000;

app.use(bodyParser.json());
app.use(cors());

const client = new Client({
  connectionString: process.env.DATABASE_URL,
  ssl: {
    rejectUnauthorized: false
  }
});

client.connect();

// Initialize database schema
client.query(`
  CREATE TABLE IF NOT EXISTS Subjects (
    id SERIAL PRIMARY KEY,
    name TEXT UNIQUE
  );
  CREATE TABLE IF NOT EXISTS Chapters (
    id SERIAL PRIMARY KEY,
    subject_id INTEGER REFERENCES Subjects(id),
    name TEXT,
    UNIQUE(subject_id, name)
  );
  CREATE TABLE IF NOT EXISTS Lectures (
    id SERIAL PRIMARY KEY,
    chapter_id INTEGER REFERENCES Chapters(id),
    name TEXT,
    file_path TEXT,
    watched BOOLEAN,
    duration INTEGER,
    UNIQUE(chapter_id, name)
  );
`);

app.get('/', (req, res) => {
  res.send('Hello World!');
});


// Get all subjects
app.get('/api/subjects', (req, res) => {
  db.all("SELECT * FROM Subjects", [], (err, rows) => {
    if (err) {
      res.status(400).json({ error: err.message });
      return;
    }
    res.json(rows);
  });
});

// Get all chapters for a subject
app.get('/api/subjects/:subjectId/chapters', (req, res) => {
  const { subjectId } = req.params;
  db.all("SELECT * FROM Chapters WHERE subject_id = ?", [subjectId], (err, rows) => {
    if (err) {
      res.status(400).json({ error: err.message });
      return;
    }
    res.json(rows);
  });
});

// Get all lectures for a chapter
app.get('/api/chapters/:chapterId/lectures', (req, res) => {
  const { chapterId } = req.params;
  db.all("SELECT Lectures.*, Subjects.name AS subject_name, Chapters.name AS chapter_name FROM Lectures JOIN Chapters ON Lectures.chapter_id = Chapters.id JOIN Subjects ON Chapters.subject_id = Subjects.id WHERE Lectures.chapter_id = ?", [chapterId], (err, rows) => {
    if (err) {
      res.status(400).json({ error: err.message });
      return;
    }

    const lecturesWithFilePath = rows.map(lecture => {
      // Replace '#' with '%23' in lecture.name
      const modifiedName = lecture.name.includes('#') ? lecture.name.replace(/#/g, '%23') : lecture.name;
      return {
        ...lecture,
        file_path: `/lectures/${lecture.subject_name}/${lecture.chapter_name}/${modifiedName}`
      };
    });

    res.json(lecturesWithFilePath);
  });
});



// Toggle watched status of a lecture
app.put('/api/lectures/:lectureId/toggle-watched', (req, res) => {
  const { lectureId } = req.params;

  db.get("SELECT watched FROM Lectures WHERE id = ?", [lectureId], (err, row) => {
    if (err) {
      res.status(400).json({ error: err.message });
      return;
    }
    const newWatchedStatus = row.watched === 1 ? 0 : 1;
    db.run("UPDATE Lectures SET watched = ? WHERE id = ?", [newWatchedStatus, lectureId], function (err) {
      if (err) {
        res.status(400).json({ error: err.message });
        return;
      }
      res.json({ id: lectureId, watched: newWatchedStatus });
    });
  });
});

// Get duration information for a chapter
app.get('/api/chapters/:chapterId/duration', (req, res) => {
  const { chapterId } = req.params;
  db.get("SELECT SUM(duration * watched) AS watched_duration, SUM(duration) AS total_duration FROM Lectures WHERE chapter_id = ?", [chapterId], (err, row) => {
    if (err) {
      res.status(400).json({ error: err.message });
      return;
    }
    console.log('Chapter Duration:', row); // Debug logging
    res.json(row);
  });
});

// Serve lectures static files
app.use('/lectures', express.static(path.join(__dirname, 'lectures')));

// Get duration information for a subject
app.get('/api/subjects/:subjectId/duration', (req, res) => {
  const { subjectId } = req.params;
  db.get("SELECT SUM(watched * duration) AS watched_duration, SUM(duration) AS total_duration FROM Lectures JOIN Chapters ON Lectures.chapter_id = Chapters.id WHERE Chapters.subject_id = ?", [subjectId], (err, row) => {
    if (err) {
      res.status(400).json({ error: err.message });
      return;
    }
    console.log('Subject Duration:', row); // Debug logging
    res.json(row);
  });
});

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
