import mongoose from "mongoose";
import bcrypt from "bcryptjs";

const userSchema = new mongoose.Schema({
  fullname: { type: String, required: true },
  email: {
    type: String,
    required: true,
    unique: true,
    lowercase: true,
    index: true,
  },
  role: {
    type: String,
    enum: ["admin", "member"],
    default: "member",
  },
  avatar: { type: String },
  passwordHash: { type: String, required: true },
  isActive: { type: Boolean, default: true },

  /* -------------------------------------------------------------------------- */
  /* 🔑 Password Reset Fields                                                   */
  /* -------------------------------------------------------------------------- */
  resetToken: { type: String, default: null },
  resetTokenExpires: { type: Date, default: null },

  /* -------------------------------------------------------------------------- */
  /* 🕒 Metadata                                                                */
  /* -------------------------------------------------------------------------- */
  createdAt: { type: Date, default: Date.now },
});

/* -------------------------------------------------------------------------- */
/* 🔐 Pre-Save Hook: Auto-hash Passwords                                      */
/* -------------------------------------------------------------------------- */
userSchema.pre("save", async function (next) {
  // Only hash password if it was modified or is new
  if (!this.isModified("passwordHash")) return next();

  try {
    const salt = await bcrypt.genSalt(10);
    this.passwordHash = await bcrypt.hash(this.passwordHash, salt);
    next();
  } catch (err) {
    next(err);
  }
});

/* -------------------------------------------------------------------------- */
/* 🔐 Verify Password Helper                                                  */
/* -------------------------------------------------------------------------- */
userSchema.methods.verifyPassword = function (password) {
  return bcrypt.compare(password, this.passwordHash);
};

/* -------------------------------------------------------------------------- */
/* 💾 Export Model                                                            */
/* -------------------------------------------------------------------------- */
export default mongoose.model("User", userSchema);
