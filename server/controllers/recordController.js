console.log("--- KODE ANALISIS PDF SEDANG BERJALAN ---");

const fs = require("fs");
const { pool } = require("../config/db");
const { GoogleGenerativeAI } = require("@google/generative-ai");
const pdf = require("pdf-parse");

// Inisialisasi Google AI (pastikan GEMINI_API_KEY ada di .env)
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

// Helper untuk hapus file sementara
function cleanupFile(filePath) {
  if (fs.existsSync(filePath)) {
    fs.unlinkSync(filePath);
  }
}

// 1️⃣ ANALISIS PDF REKAM MEDIS
const analyzeRecord = async (req, res) => {
  if (!req.file) {
    return res.status(400).json({ message: "File PDF rekam medis harus diunggah" });
  }

  const pdfPath = req.file.path;

  try {
    // Ekstrak teks dari PDF
    const dataBuffer = fs.readFileSync(pdfPath);
    const pdfData = await pdf(dataBuffer);
    const pdfText = pdfData.text;

    // Gunakan model Gemini 1.5 Pro
    const model = genAI.getGenerativeModel({ model: "gemini-1.5-pro-latest" });

    const prompt = `
Anda adalah asisten medis AI profesional. 
Analisis teks rekam medis berikut ini secara mendalam, ringkas, dan jelas.

Teks Rekam Medis:
"""
${pdfText}
"""

Keluarkan hasil DALAM FORMAT JSON VALID dengan struktur:
{
  "patient_name": "...",
  "diagnosis_summary": "...",
  "key_metrics": [
    { "metric": "Tekanan Darah", "value": "..." },
    { "metric": "Kolesterol Total", "value": "..." },
    { "metric": "Gula Darah", "value": "..." }
  ],
  "medications": [
    { "name": "...", "dosage": "..." }
  ],
  "recommendations": "..."
}
Pastikan tidak ada teks tambahan di luar objek JSON.
`;

    // Panggil Gemini
    const result = await model.generateContent(prompt);
    let responseText = result.response.text().trim();

    // ✅ Tambahkan fallback JSON agar tidak error bila output AI berantakan
    let analysisResult;
    try {
      // Bersihkan jika AI mengirim teks di luar JSON
      const jsonStart = responseText.indexOf("{");
      const jsonEnd = responseText.lastIndexOf("}");
      if (jsonStart !== -1 && jsonEnd !== -1) {
        responseText = responseText.slice(jsonStart, jsonEnd + 1);
      }
      analysisResult = JSON.parse(responseText);
    } catch (err) {
      console.error("⚠️ Respons AI bukan JSON valid:", responseText);
      analysisResult = {
        patient_name: "Tidak ditemukan",
        diagnosis_summary: "Tidak dapat dianalisis (format tidak valid)",
        key_metrics: [],
        medications: [],
        recommendations: "Periksa ulang file PDF atau ulangi analisis."
      };
    }

    // Simpan hasil ke database
    const userId = req.user.id;
    const fileName = req.file.filename;

    await pool.query(
      "INSERT INTO medical_analyses (user_id, file_name, analysis_summary) VALUES (?, ?, ?)",
      [userId, fileName, JSON.stringify(analysisResult)]
    );

    res.status(200).json({
      message: "Analisis PDF berhasil",
      data: analysisResult,
    });
  } catch (error) {
    console.error("❌ Error saat analisis PDF:", error);
    res.status(500).json({ message: "Gagal menganalisis PDF" });
  } finally {
    cleanupFile(pdfPath);
  }
};

// 2️⃣ AMBIL RIWAYAT ANALISIS REKAM MEDIS
const getRecordHistory = async (req, res) => {
  try {
    const userId = req.user.id;

    const query = `
      SELECT 
        id, 
        file_name, 
        analysis_summary, 
        created_at
      FROM medical_analyses
      WHERE user_id = ?
      ORDER BY created_at DESC
      LIMIT 10;
    `;

    const [history] = await pool.query(query, [userId]);

    // Parsing JSON hasil analisis sebelum dikirim ke frontend
    const parsedHistory = history.map((item) => ({
      ...item,
      analysis_summary: JSON.parse(item.analysis_summary),
    }));

    res.status(200).json(parsedHistory);
  } catch (error) {
    console.error("❌ Error saat mengambil riwayat rekam medis:", error);
    res.status(500).json({ message: "Gagal mengambil riwayat rekam medis" });
  }
};

// 3️⃣ EXPORT SEMUA
module.exports = {
  analyzeRecord,
  getRecordHistory,
};
