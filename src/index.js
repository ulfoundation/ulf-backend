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

// ✅ Basic CORS (allow frontend)
app.use(
  cors({
    origin: process.env.ORIGIN || 'http://localhost:5173',
    credentials: true,
  })
);

// ✅ Core middleware
app.use(express.json({ limit: '2mb' })); // slightly larger for markdown + images
app.use(morgan('dev'));

// ✅ Serve uploaded static files
app.use('/uploads', express.static(path.join(process.cwd(), 'uploads')));

// ✅ API Routes
app.use('/api/auth', authRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api/posts', postRoutes);
app.use('/api/donations', donationRoutes);
app.use('/api/search', searchRoutes);
app.use("/api/about", aboutRoutes);
app.use("/api/contact", contactRoutes);
app.use("/api/team", teamRoutes);
app.use("/api/members", memberRoutes);
app.use("/api/upload", uploadRoutes);



// ✅ Root route
app.get('/', (req, res) => res.send('🌍 ULF API is running successfully.'));

// ✅ Start Server
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
