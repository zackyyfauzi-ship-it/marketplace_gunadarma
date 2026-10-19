require("dotenv").config();

const path = require("node:path");
const fs = require("node:fs");
const crypto = require("node:crypto");
const express = require("express");
const session = require("express-session");
const PgSession = require("connect-pg-simple")(session);
const bcrypt = require("bcryptjs");
const multer = require("multer");
const helmet = require("helmet");
const { rateLimit } = require("express-rate-limit");
const { Pool } = require("pg");

const app = express();
const port = Number(process.env.PORT || 3000);
const host = process.env.HOST || "192.168.1.83";
const sessionSecret = process.env.SESSION_SECRET || crypto.randomBytes(32).toString("hex");
const uploadDir = path.join(__dirname, "uploads");
const pool = new Pool({
  connectionString: process.env.DATABASE_URL || "postgres://postgres:password@localhost:5432/marketplace_gunadarma",
});

fs.mkdirSync(uploadDir, { recursive: true });

const allowedNpmPrefixes = new Set([
  "101", "504", "111", "102", "202", "206", "112", "212",
  "514", "524", "304", "501", "204", "214", "105", "108",
  "702", "404", "712",
]);
const conditionLabels = {
  needs_repair: "Perlu perbaikan",
  fair: "Layak",
  good: "Bagus",
  like_new: "Seperti baru",
};

const storage = multer.diskStorage({
  destination: (_req, _file, callback) => callback(null, uploadDir),
  filename: (_req, file, callback) => {
    const extensions = { "image/jpeg": ".jpg", "image/png": ".png", "image/webp": ".webp" };
    callback(null, `${crypto.randomUUID()}${extensions[file.mimetype]}`);
  },
});
const imageUpload = multer({
  storage,
  limits: { fileSize: 5 * 1024 * 1024, files: 4 },
  fileFilter: (_req, file, callback) => {
    if (!["image/jpeg", "image/png", "image/webp"].includes(file.mimetype)) {
      callback(new Error("Foto harus berformat JPG, PNG, atau WebP."));
      return;
    }
    callback(null, true);
  },
});

app.disable("x-powered-by");
app.use(helmet({contentSecurityPolicy: false, crossOriginResourcePolicy: { policy: "same-site" } }));
app.use(express.json({ limit: "20kb" }));
app.use(express.urlencoded({ extended: false, limit: "20kb" }));
app.use(session({
  store: new PgSession({ pool, createTableIfMissing: true }),
  secret: sessionSecret,
  resave: false,
  saveUninitialized: false,
  cookie: {
    httpOnly: true,
    sameSite: "lax",
    secure: false,
    maxAge: 7 * 24 * 60 * 60 * 1000,
  },
}));
app.use("/uploads", express.static(uploadDir, { maxAge: "1d", dotfiles: "deny" }));
app.use(express.static(path.join(__dirname, "public")));

function requireAuth(req, res, next) {
  if (!req.session.userId) {
    res.status(401).json({ error: "Silakan masuk terlebih dahulu." });
    return;
  }
  next();
}

function validateNpm(npm) {
  if (!/^\d{8}$/.test(npm || "")) return "NPM harus terdiri dari tepat 8 digit.";
  if (!allowedNpmPrefixes.has(npm.slice(0, 3))) return "Kode program pada NPM tidak terdaftar.";
  const year = 2000 + Number(npm.slice(3, 5));
  if (year > new Date().getFullYear()) return "Tahun masuk pada NPM tidak valid.";
  if (Number(npm.slice(5)) === 0) return "Tiga digit terakhir NPM tidak boleh 000.";
  return null;
}

function profileShape(row) {
  return {
    id: row.id,
    name: row.full_name,
    username: row.username,
    displayName: row.username || row.full_name,
    npm: row.npm,
    phone: row.phone,
    avatarUrl: row.avatar_url,
  };
}

function handleRoute(handler) {
  return (req, res, next) => Promise.resolve(handler(req, res, next)).catch(next);
}

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 20,
  standardHeaders: "draft-7",
  legacyHeaders: false,
  message: { error: "Terlalu banyak percobaan. Coba lagi dalam beberapa menit." },
});

app.get("/api/me", handleRoute(async (req, res) => {
  if (!req.session.userId) {
    res.json({ user: null });
    return;
  }
  const result = await pool.query(
    "SELECT id, npm, full_name, username, phone, avatar_url FROM users WHERE id = $1",
    [req.session.userId],
  );
  if (!result.rowCount) {
    req.session.destroy(() => {});
    res.json({ user: null });
    return;
  }
  res.json({ user: profileShape(result.rows[0]) });
}));

app.post("/api/register", authLimiter, handleRoute(async (req, res) => {
  const npm = String(req.body.npm || "").trim();
  const fullName = String(req.body.fullName || "").trim();
  const phone = String(req.body.phone || "").replace(/[\s-]/g, "");
  const password = String(req.body.password || "");
  const usernameInput = String(req.body.username || "").trim();
  const username = usernameInput || null;
  const npmError = validateNpm(npm);
  if (npmError) return res.status(400).json({ error: npmError });
  if (fullName.length < 2 || fullName.length > 100) {
    return res.status(400).json({ error: "Nama harus berisi 2–100 karakter." });
  }
  if (username && !/^[A-Za-z0-9_]{3,30}$/.test(username)) {
    return res.status(400).json({ error: "Username harus 3–30 karakter: huruf, angka, atau garis bawah." });
  }
  if (!/^08\d{8,11}$/.test(phone)) {
    return res.status(400).json({ error: "Nomor telepon harus berupa nomor Indonesia, misalnya 081234567890." });
  }
  if (password.length < 8 || password.length > 72) {
    return res.status(400).json({ error: "Kata sandi harus berisi 8–72 karakter." });
  }
  const program = await pool.query("SELECT 1 FROM study_programs WHERE prefix = $1", [npm.slice(0, 3)]);
  if (!program.rowCount) return res.status(400).json({ error: "Kode program pada NPM tidak terdaftar." });
  const passwordHash = await bcrypt.hash(password, 12);
  try {
    const result = await pool.query(
      `INSERT INTO users (npm, full_name, username, phone, password_hash)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING id, npm, full_name, username, phone, avatar_url`,
      [npm, fullName, username, phone, passwordHash],
    );
    await new Promise((resolve, reject) => {
      req.session.regenerate((error) => {
        if (error) return reject(error);
        req.session.userId = result.rows[0].id;
        req.session.save((saveError) => saveError ? reject(saveError) : resolve());
      });
    });
    res.status(201).json({ user: profileShape(result.rows[0]) });
  } catch (error) {
    if (error.code === "23505") return res.status(409).json({ error: "NPM, username, atau nomor telepon sudah digunakan." });
    if (error.code === "23503" || error.code === "23514") {
      return res.status(400).json({ error: "NPM tidak memenuhi aturan validasi database." });
    }
    throw error;
  }
}));

app.post("/api/login", authLimiter, handleRoute(async (req, res) => {
  const npm = String(req.body.npm || "").trim();
  const password = String(req.body.password || "");
  const npmError = validateNpm(npm);
  if (npmError) return res.status(400).json({ error: npmError });
  const result = await pool.query(
    "SELECT id, npm, full_name, username, phone, avatar_url, password_hash FROM users WHERE npm = $1",
    [npm],
  );
  if (!result.rowCount || !(await bcrypt.compare(password, result.rows[0].password_hash))) {
    return res.status(401).json({ error: "NPM atau kata sandi salah." });
  }
  req.session.regenerate((error) => {
    if (error) return res.status(500).json({ error: "Sesi gagal dibuat. Silakan coba lagi." });
    req.session.userId = result.rows[0].id;
    req.session.save((saveError) => {
      if (saveError) return res.status(500).json({ error: "Sesi gagal disimpan. Silakan coba lagi." });
      res.json({ user: profileShape(result.rows[0]) });
    });
  });
}));

app.post("/api/logout", requireAuth, (req, res, next) => {
  req.session.destroy((error) => {
    if (error) return next(error);
    res.clearCookie("connect.sid");
    res.json({ ok: true });
  });
});

app.put("/api/profile", requireAuth, imageUpload.single("avatar"), handleRoute(async (req, res) => {
  const fullName = String(req.body.fullName || "").trim();
  const usernameInput = String(req.body.username || "").trim();
  const username = usernameInput || null;
  const phone = String(req.body.phone || "").replace(/[\s-]/g, "");
  if (fullName.length < 2 || fullName.length > 100) return res.status(400).json({ error: "Nama harus berisi 2–100 karakter." });
  if (username && !/^[A-Za-z0-9_]{3,30}$/.test(username)) {
    return res.status(400).json({ error: "Username harus 3–30 karakter: huruf, angka, atau garis bawah." });
  }
  if (!/^08\d{8,11}$/.test(phone)) {
    return res.status(400).json({ error: "Nomor telepon harus berupa nomor Indonesia, misalnya 081234567890." });
  }
  const avatarUrl = req.file ? `/uploads/${req.file.filename}` : undefined;
  let result;
  try {
    result = await pool.query(
      `UPDATE users SET full_name = $1, username = $2, phone = $3,
         avatar_url = COALESCE($4, avatar_url)
       WHERE id = $5
       RETURNING id, npm, full_name, username, phone, avatar_url`,
      [fullName, username, phone, avatarUrl || null, req.session.userId],
    );
  } catch (error) {
    if (error.code === "23505") return res.status(409).json({ error: "Username atau nomor telepon sudah digunakan." });
    throw error;
  }
  res.json({ user: profileShape(result.rows[0]) });
}));

app.get("/api/categories", handleRoute(async (_req, res) => {
  const result = await pool.query("SELECT id, name FROM categories ORDER BY id");
  res.json({ categories: result.rows });
}));

const listingSelect = `
  SELECT l.id, l.seller_id, l.category_id, c.name AS category,
         l.title, l.description, l.price, l.item_condition, l.meetup_location,
         l.status, l.created_at, l.sold_at,
         COALESCE(u.username, u.full_name) AS seller_name,
         u.avatar_url AS seller_avatar,
         (SELECT li.url FROM listing_images li WHERE li.listing_id = l.id ORDER BY li.position LIMIT 1) AS image_url
  FROM listings l
  JOIN users u ON u.id = l.seller_id
  JOIN categories c ON c.id = l.category_id`;

app.get("/api/listings", handleRoute(async (req, res) => {
  const values = [];
  const filters = [];
  if (req.query.mine === "true") {
    if (!req.session.userId) return res.status(401).json({ error: "Silakan masuk terlebih dahulu." });
    values.push(req.session.userId);
    filters.push(`l.seller_id = $${values.length}`);
  } else {
    filters.push("(l.status = 'active' OR (l.status = 'sold' AND l.sold_at > now() - interval '3 days'))");
  }
  if (req.query.category) {
    const categoryId = Number(req.query.category);
    if (!Number.isInteger(categoryId) || categoryId < 1) {
      return res.status(400).json({ error: "Kategori tidak valid." });
    }
    values.push(categoryId);
    filters.push(`l.category_id = $${values.length}`);
  }
  if (req.query.q) {
    values.push(`%${String(req.query.q).trim().slice(0, 100)}%`);
    filters.push(`(l.title ILIKE $${values.length} OR l.description ILIKE $${values.length})`);
  }
  const result = await pool.query(
    `${listingSelect} WHERE ${filters.join(" AND ")} ORDER BY l.created_at DESC LIMIT 100`,
    values,
  );
  res.json({ listings: result.rows });
}));

app.get("/api/listings/:id", handleRoute(async (req, res) => {
  const result = await pool.query(
    `${listingSelect} WHERE l.id = $1 AND
       (l.status <> 'sold' OR l.sold_at > now() - interval '3 days')`,
    [req.params.id],
  );
  if (!result.rowCount) return res.status(404).json({ error: "Barang tidak ditemukan." });
  const images = await pool.query(
    "SELECT url FROM listing_images WHERE listing_id = $1 ORDER BY position",
    [req.params.id],
  );
  res.json({ listing: { ...result.rows[0], images: images.rows.map((row) => row.url) } });
}));

app.post("/api/listings", requireAuth, imageUpload.array("images", 4), handleRoute(async (req, res) => {
  const title = String(req.body.title || "").trim();
  const description = String(req.body.description || "").trim();
  const categoryId = Number(req.body.categoryId);
  const price = Number(req.body.price);
  const itemCondition = String(req.body.itemCondition || "");
  const meetupLocation = String(req.body.meetupLocation || "").trim() || null;
  if (title.length < 3 || title.length > 150) return res.status(400).json({ error: "Judul harus berisi 3–150 karakter." });
  if (description.length < 1 || description.length > 5000) return res.status(400).json({ error: "Deskripsi wajib diisi (maksimal 5000 karakter)." });
  if (!Number.isSafeInteger(price) || price < 0 || price > 999999999999) return res.status(400).json({ error: "Harga tidak valid." });
  if (!Object.hasOwn(conditionLabels, itemCondition)) return res.status(400).json({ error: "Pilih kondisi barang yang tersedia." });
  if (meetupLocation && meetupLocation.length > 150) return res.status(400).json({ error: "Lokasi meetup maksimal 150 karakter." });
  const category = await pool.query("SELECT id FROM categories WHERE id = $1", [categoryId]);
  if (!category.rowCount) return res.status(400).json({ error: "Kategori tidak valid." });

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const result = await client.query(
      `INSERT INTO listings (seller_id, category_id, title, description, price, item_condition, meetup_location)
       VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id`,
      [req.session.userId, categoryId, title, description, price, itemCondition, meetupLocation],
    );
    for (const [position, file] of (req.files || []).entries()) {
      await client.query(
        "INSERT INTO listing_images (listing_id, url, position) VALUES ($1, $2, $3)",
        [result.rows[0].id, `/uploads/${file.filename}`, position],
      );
    }
    await client.query("COMMIT");
    res.status(201).json({ id: result.rows[0].id });
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}));

app.patch("/api/listings/:id/status", requireAuth, handleRoute(async (req, res) => {
  const status = String(req.body.status || "");
  if (!["active", "sold", "hidden"].includes(status)) return res.status(400).json({ error: "Status barang tidak valid." });
  const result = await pool.query(
    `UPDATE listings SET status = $1::varchar,
       sold_at = CASE WHEN $1::varchar = 'sold'::varchar THEN COALESCE(sold_at, now()) ELSE NULL END
     WHERE id = $2 AND seller_id = $3 RETURNING id, status, sold_at`,
    [status, req.params.id, req.session.userId],
  );
  if (!result.rowCount) return res.status(404).json({ error: "Barang tidak ditemukan atau bukan milik Anda." });
  res.json({ listing: result.rows[0] });
}));

app.get("/api/conversations", requireAuth, handleRoute(async (req, res) => {
  const result = await pool.query(
    `SELECT co.id, co.listing_id, l.title AS listing_title, l.status AS listing_status,
       CASE WHEN co.buyer_id = $1 THEN COALESCE(s.username, s.full_name)
            ELSE COALESCE(b.username, b.full_name) END AS other_name,
       (SELECT body FROM messages m WHERE m.conversation_id = co.id ORDER BY m.created_at DESC LIMIT 1) AS last_message,
       (SELECT created_at FROM messages m WHERE m.conversation_id = co.id ORDER BY m.created_at DESC LIMIT 1) AS last_message_at
     FROM conversations co
     JOIN listings l ON l.id = co.listing_id
     JOIN users b ON b.id = co.buyer_id
     JOIN users s ON s.id = co.seller_id
     WHERE co.buyer_id = $1 OR co.seller_id = $1
     ORDER BY COALESCE(
       (SELECT created_at FROM messages m WHERE m.conversation_id = co.id ORDER BY m.created_at DESC LIMIT 1),
       co.created_at
     ) DESC`,
    [req.session.userId],
  );
  res.json({ conversations: result.rows });
}));

async function getConversationForUser(conversationId, userId) {
  const result = await pool.query(
    "SELECT id FROM conversations WHERE id = $1 AND (buyer_id = $2 OR seller_id = $2)",
    [conversationId, userId],
  );
  return result.rowCount > 0;
}

app.get("/api/conversations/:id/messages", requireAuth, handleRoute(async (req, res) => {
  if (!(await getConversationForUser(req.params.id, req.session.userId))) {
    return res.status(404).json({ error: "Percakapan tidak ditemukan." });
  }
  const result = await pool.query(
    `SELECT m.id, m.body, m.created_at, m.sender_id,
       COALESCE(u.username, u.full_name) AS sender_name
     FROM messages m JOIN users u ON u.id = m.sender_id
     WHERE m.conversation_id = $1 ORDER BY m.created_at ASC LIMIT 500`,
    [req.params.id],
  );
  res.json({ messages: result.rows });
}));

app.post("/api/conversations", requireAuth, handleRoute(async (req, res) => {
  const listing = await pool.query(
    "SELECT id, seller_id, status FROM listings WHERE id = $1",
    [req.body.listingId],
  );
  if (!listing.rowCount || listing.rows[0].status !== "active") {
    return res.status(404).json({ error: "Barang sudah tidak tersedia." });
  }
  if (String(listing.rows[0].seller_id) === String(req.session.userId)) {
    return res.status(400).json({ error: "Anda tidak dapat memulai chat dengan diri sendiri." });
  }
  const result = await pool.query(
    `INSERT INTO conversations (listing_id, buyer_id, seller_id)
     VALUES ($1, $2, $3)
     ON CONFLICT (listing_id, buyer_id, seller_id)
     DO UPDATE SET listing_id = EXCLUDED.listing_id
     RETURNING id`,
    [listing.rows[0].id, req.session.userId, listing.rows[0].seller_id],
  );
  res.status(201).json({ conversationId: result.rows[0].id });
}));

app.post("/api/conversations/:id/messages", requireAuth, handleRoute(async (req, res) => {
  const body = String(req.body.body || "").trim();
  if (body.length < 1 || body.length > 2000) return res.status(400).json({ error: "Pesan harus berisi 1–2000 karakter." });
  if (!(await getConversationForUser(req.params.id, req.session.userId))) {
    return res.status(404).json({ error: "Percakapan tidak ditemukan." });
  }
  const result = await pool.query(
    `INSERT INTO messages (conversation_id, sender_id, body)
     VALUES ($1, $2, $3) RETURNING id, body, created_at, sender_id`,
    [req.params.id, req.session.userId, body],
  );
  res.status(201).json({ message: result.rows[0] });
}));

async function cleanupExpiredListings() {
  const oldImages = await pool.query(
    `SELECT li.url FROM listing_images li
     JOIN listings l ON l.id = li.listing_id
     WHERE l.status = 'sold' AND l.sold_at <= now() - interval '3 days'`,
  );
  await pool.query("DELETE FROM listings WHERE status = 'sold' AND sold_at <= now() - interval '3 days'");
  for (const image of oldImages.rows) {
    const filename = path.basename(image.url);
    try {
      await fs.promises.unlink(path.join(uploadDir, filename));
    } catch (error) {
      if (error.code !== "ENOENT") console.error("Gagal menghapus foto barang terjual:", error);
    }
  }
}

app.use((error, _req, res, _next) => {
  if (error instanceof multer.MulterError) {
    res.status(400).json({ error: error.code === "LIMIT_FILE_SIZE" ? "Ukuran foto maksimal 5 MB." : "Jumlah foto maksimal 4." });
    return;
  }
  if (error.message === "Foto harus berformat JPG, PNG, atau WebP.") {
    res.status(400).json({ error: error.message });
    return;
  }
  console.error(error);
  res.status(500).json({ error: "Terjadi kesalahan pada server. Silakan coba lagi." });
});

pool.query("SELECT 1")
  .then(() => cleanupExpiredListings())
  .then(() => {
    setInterval(() => {
      cleanupExpiredListings().catch((error) => console.error("Pembersihan barang terjual gagal:", error));
    }, 60 * 60 * 1000).unref();
    app.listen(port, host, () => console.log(`Marketplace Gunadarma berjalan di http://${host}:${port}`));
  })
  .catch((error) => {
    console.error("Tidak dapat terhubung ke PostgreSQL. Periksa DATABASE_URL dan jalankan schema.sql.", error);
    process.exitCode = 1;
  });
