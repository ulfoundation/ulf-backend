import mongoose from "mongoose";

const MemberSchema = new mongoose.Schema(
  {
    /* ---------------------------------------------------------------------- */
    /* 🧾 Registration Info */
    /* ---------------------------------------------------------------------- */
    dateOfRegistration: {
      type: String,
      required: [true, "Date of registration is required"],
      trim: true,
    },

    /* ---------------------------------------------------------------------- */
    /* 🧍 Personal Details */
    /* ---------------------------------------------------------------------- */
    name: {
      type: String,
      required: [true, "Full name is required"],
      trim: true,
    },
    role: {
      type: String,
      default: "Member",
      enum: ["Member", "Beneficiary", "Ambassador", "Volunteer", "Admin"],
    },
    email: {
      type: String,
      required: [true, "Email is required"],
      unique: true, // ✅ Mongoose automatically creates an index for this
      trim: true,
      lowercase: true,
    },
    phone: {
      type: String,
      required: [true, "Phone number is required"],
      unique: true, // ✅ Avoid adding duplicate .index() below
      trim: true,
    },
    dateOfBirth: { type: String },
    maritalStatus: {
      type: String,
      enum: ["Single", "Married", "Widowed", "Divorced", "Other"],
      default: "Single",
    },

    /* ---------------------------------------------------------------------- */
    /* 🏠 Address Information */
    /* ---------------------------------------------------------------------- */
    address: { type: String },
    lga: { type: String },
    state: { type: String },
    nationality: { type: String },

    /* ---------------------------------------------------------------------- */
    /* 🎓 Education & Skills */
    /* ---------------------------------------------------------------------- */
    educationLevel: { type: String },
    occupation: { type: String },
    skills: { type: String },

    /* ---------------------------------------------------------------------- */
    /* ❤️ Health & Family */
    /* ---------------------------------------------------------------------- */
    healthStatus: { type: String },
    numberOfDependents: { type: String },

    /* ---------------------------------------------------------------------- */
    /* 💰 Foundation Support */
    /* ---------------------------------------------------------------------- */
    supportNeeded: { type: String, maxlength: 500 },

    /* ---------------------------------------------------------------------- */
    /* 🖼️ Avatar */
    /* ---------------------------------------------------------------------- */
    avatar: {
      type: String,
      default: "/ulf_logo.png",
    },

    /* ---------------------------------------------------------------------- */
    /* 🪪 Account Status */
    /* ---------------------------------------------------------------------- */
    status: {
      type: String,
      enum: ["active", "banned", "inactive"],
      default: "active",
    },
  },
  { timestamps: true }
);

// ✅ Removed duplicate manual index definitions
export default mongoose.model("Member", MemberSchema);
