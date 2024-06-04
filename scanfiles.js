const express = require('express');
const bodyParser = require('body-parser');
const cors = require('cors');
const { Client } = require('pg');
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const app = express();
const PORT = 5000;
const LECTURES_DIR = './lectures'; // Update this path to your lectures directory

app.use(bodyParser.json());
app.use(cors());

const client = new Client({
  connectionString: process.env.DATABASE_URL,
  ssl: {
    rejectUnauthorized: false
  }
});

client.connect();

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

function getLectureDuration(filePath) {
  try {
    const duration = execSync(`ffprobe -v error -show_entries format=duration -of default=noprint_wrappers=1:nokey=1 "${filePath}"`, { encoding: 'utf8' });
    return parseFloat(duration.trim());
  } catch (error) {
    console.error('Error getting lecture duration:', error);
    return 0; // Return 0 if duration cannot be extracted
  }
}

function processLectures(chapterPath, chapterId) {
  fs.readdir(chapterPath, (err, lectures) => {
    if (err) {
      console.error('Error reading lectures directory:', err);
      return;
    }

    lectures.forEach(lecture => {
      const lecturePath = path.join(chapterPath, lecture);
      if (fs.lstatSync(lecturePath).isFile() && path.extname(lecture) === '.mp4') {
        const lectureDuration = getLectureDuration(lecturePath);
        client.query("SELECT id FROM Lectures WHERE chapter_id = $1 AND name = $2", [chapterId, lecture], (err, result) => {
          if (err) {
            console.error('Error querying lecture:', err);
            return;
          }
          if (result.rows.length === 0) {
            client.query("INSERT INTO Lectures (chapter_id, name, file_path, watched, duration) VALUES ($1, $2, $3, $4, $5)", [chapterId, lecture, lecturePath, false, lectureDuration], (err) => {
              if (err) {
                console.error('Error inserting lecture:', err);
              }
            });
          }
        });
      }
    });
  });
}

function scanAndPopulateDatabase(dir) {
  fs.readdir(dir, (err, subjects) => {
    if (err) {
      console.error('Error reading subjects directory:', err);
      return;
    }

    subjects.forEach(subject => {
      const subjectPath = path.join(dir, subject);
      if (fs.lstatSync(subjectPath).isDirectory()) {
        client.query("SELECT id FROM Subjects WHERE name = $1", [subject], (err, result) => {
          if (err) {
            console.error('Error querying subject:', err);
            return;
          }
          if (result.rows.length === 0) {
            client.query("INSERT INTO Subjects (name) VALUES ($1) RETURNING id", [subject], (err, result) => {
              if (err) {
                console.error('Error inserting subject:', err);
                return;
              }
              const subjectId = result.rows[0].id;
              processChapters(subjectPath, subjectId);
            });
          } else {
            processChapters(subjectPath, result.rows[0].id);
          }
        });
      }
    });
  });
}

function processChapters(subjectPath, subjectId) {
  fs.readdir(subjectPath, (err, chapters) => {
    if (err) {
      console.error('Error reading chapters directory:', err);
      return;
    }

    chapters.forEach(chapter => {
      const chapterPath = path.join(subjectPath, chapter);
      if (fs.lstatSync(chapterPath).isDirectory()) {
        client.query("SELECT id FROM Chapters WHERE subject_id = $1 AND name = $2", [subjectId, chapter], (err, result) => {
          if (err) {
            console.error('Error querying chapter:', err);
            return;
          }
          if (result.rows.length === 0) {
            client.query("INSERT INTO Chapters (subject_id, name) VALUES ($1, $2) RETURNING id", [subjectId, chapter], (err, result) => {
              if (err) {
                console.error('Error inserting chapter:', err);
                return;
              }
              const chapterId = result.rows[0].id;
              processLectures(chapterPath, chapterId);
            });
          } else {
            processLectures(chapterPath, result.rows[0].id);
          }
        });
      }
    });
  });
}

// Scan the directory and populate the database
scanAndPopulateDatabase(LECTURES_DIR);

app.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});
