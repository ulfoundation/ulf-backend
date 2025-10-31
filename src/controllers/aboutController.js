import AboutSection from "../models/AboutSection.js";

/* ---------------------------- Get All Sections ---------------------------- */
export const getAllSections = async (req, res) => {
  try {
    const sections = await AboutSection.find().sort({ createdAt: 1 });
    res.json(sections);
  } catch (err) {
    console.error("❌ Error fetching sections:", err);
    res.status(500).json({ message: "Failed to fetch sections" });
  }
};

/* ---------------------------- Get Single Section ---------------------------- */
export const getSection = async (req, res) => {
  try {
    const { section } = req.params;
    const data = await AboutSection.findOne({ key: section });
    if (!data) return res.status(404).json({ message: "Section not found" });
    res.json(data);
  } catch (err) {
    console.error("❌ Error fetching section:", err);
    res.status(500).json({ message: "Failed to fetch section" });
  }
};

/* ---------------------------- Update Section ---------------------------- */
export const updateSection = async (req, res) => {
  try {
    const { section } = req.params;
    const { content, updatedBy } = req.body;

    const updated = await AboutSection.findOneAndUpdate(
      { key: section },
      { content, updatedBy },
      { new: true }
    );

    if (!updated) return res.status(404).json({ message: "Section not found" });
    res.json({ success: true, about: updated });
  } catch (err) {
    console.error("❌ Error updating section:", err);
    res.status(500).json({ message: "Failed to update section" });
  }
};

/* ---------------------------- Seed Default Sections ---------------------------- */
export const seedSections = async (req, res) => {
  try {
    const defaults = [
      { key: "our-story", title: "Our Story", content: "Write about your origin story here." },
      { key: "mission", title: "Mission", content: "Describe your mission and goals." },
      { key: "vision", title: "Vision", content: "Share your long-term vision." },
      { key: "impact", title: "Impact", content: "Highlight your impact or achievements." },
      { key: "leadership", title: "Leadership", content: "List leadership team or philosophy." },
    ];

    for (const item of defaults) {
      const exists = await AboutSection.findOne({ key: item.key });
      if (!exists) await AboutSection.create(item);
    }

    const all = await AboutSection.find();
    res.json({ success: true, count: all.length, sections: all });
  } catch (err) {
    console.error("❌ Error seeding sections:", err);
    res.status(500).json({ message: "Failed to seed sections" });
  }
};
