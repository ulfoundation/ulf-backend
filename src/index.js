import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import morgan from 'morgan';
import path from 'path';
import connectDB from './config/db.js';

// 🧩 Routes
import authRoutes from './routes/auth.js';
import adminRoutes from './routes/admin.js';
import postRoutes from './routes/posts.js';
import donationRoutes from './routes/donations.js';
import searchRoutes from './routes/search.js';
import aboutRoutes from "./routes/about.js";
import memberRoutes from "./routes/member.js";
import contactRoutes from "./routes/contact.js";
import teamRoutes from "./routes/team.js";
import uploadRoutes from "./routes/upload.js";

// Initialize app
const app = express();

/* -------------------------------------------------------------------------- */
/* 🌐 CORS SETUP — Allow local + production domains                           */
/* -------------------------------------------------------------------------- */
const allowedOrigins = [
  'http://localhost:5173',              // local development (Vite)
  'https://unitedlinkfoundation.com',   // production site (Namecheap)
  'https://www.unitedlinkfoundation.com', // www version (optional)
];

app.use(
  cors({
    origin: function (origin, callback) {
      // Allow requests with no origin (like mobile apps or curl)
      if (!origin || allowedOrigins.includes(origin)) {
        callback(null, true);
      } else {
        console.warn(`❌ Blocked by CORS: ${origin}`);
        callback(new Error('Not allowed by CORS'));
      }
    },
    credentials: true,
  })
);

/* -------------------------------------------------------------------------- */
/* 🧩 Core Middleware                                                         */
/* -------------------------------------------------------------------------- */
app.use(express.json({ limit: '2mb' }));
app.use(morgan('dev'));

/* -------------------------------------------------------------------------- */
/* 📁 Static Files                                                            */
/* -------------------------------------------------------------------------- */
app.use('/uploads', express.static(path.join(process.cwd(), 'uploads')));

/* -------------------------------------------------------------------------- */
/* 🚏 API Routes                                                              */
/* -------------------------------------------------------------------------- */
app.use('/api/auth', authRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api/posts', postRoutes);
app.use('/api/donations', donationRoutes);
app.use('/api/search', searchRoutes);
app.use('/api/about', aboutRoutes);
app.use('/api/contact', contactRoutes);
app.use('/api/team', teamRoutes);
app.use('/api/members', memberRoutes);
app.use('/api/upload', uploadRoutes);

/* -------------------------------------------------------------------------- */
/* 🌍 Root Route                                                              */
/* -------------------------------------------------------------------------- */
app.get('/', (req, res) => res.send('🌍 ULF API is running successfully.'));

/* -------------------------------------------------------------------------- */
/* 🚀 Start Server                                                            */
/* -------------------------------------------------------------------------- */
const PORT = process.env.PORT || 5020;

connectDB()
  .then(() => {
    app.listen(PORT, () => {
      console.log(`✅ Server running at http://localhost:${PORT}`);
    });
  })
  .catch((err) => {
    console.error('❌ DB connection failed:', err.message);
    process.exit(1);
  });
