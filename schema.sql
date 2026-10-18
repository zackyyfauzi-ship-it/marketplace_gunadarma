-- Skema marketplace lokal mahasiswa Universitas Gunadarma.
-- Jalankan: psql -d marketplace_gunadarma -f schema.sql

CREATE TABLE IF NOT EXISTS faculties (
    code VARCHAR(10) PRIMARY KEY,
    name VARCHAR(150) NOT NULL
);

CREATE TABLE IF NOT EXISTS study_programs (
    prefix VARCHAR(3) PRIMARY KEY CHECK (prefix ~ '^[0-9]{3}$'),
    faculty_code VARCHAR(10) NOT NULL REFERENCES faculties(code),
    program_code VARCHAR(2) NOT NULL CHECK (program_code ~ '^[0-9]{2}$'),
    degree VARCHAR(10) NOT NULL,
    name VARCHAR(150) NOT NULL
);

INSERT INTO faculties (code, name) VALUES
    ('FIKTI', 'Fakultas Ilmu Komputer & Teknologi Informasi (FIKTI)'),
    ('FE', 'Fakultas Ekonomi (FE)'),
    ('FTI', 'Fakultas Teknologi Industri (FTI)'),
    ('FTSP', 'Fakultas Teknik Sipil & Perencanaan (FTSP)'),
    ('FPS', 'Fakultas Psikologi & Fakultas Sastra'),
    ('FIKES', 'Fakultas Ilmu Kesehatan & Farmasi / Agroteknologi')
ON CONFLICT (code) DO UPDATE SET name = EXCLUDED.name;

INSERT INTO study_programs (prefix, faculty_code, program_code, degree, name) VALUES
    ('101', 'FIKTI', '01', 'S1', 'Sistem Informasi'),
    ('504', 'FIKTI', '04', 'S1', 'Informatika / Teknik Informatika'),
    ('111', 'FIKTI', '11', 'D3', 'Manajemen Informatika'),
    ('102', 'FE', '02', 'S1', 'Manajemen'),
    ('202', 'FE', '02', 'S1', 'Akuntansi'),
    ('206', 'FE', '06', 'S1', 'Ekonomi Syariah'),
    ('112', 'FE', '12', 'D3', 'Manajemen Pemasaran'),
    ('212', 'FE', '12', 'D3', 'Akuntansi'),
    ('514', 'FTI', '14', 'S1', 'Teknik Elektro'),
    ('524', 'FTI', '24', 'S1', 'Teknik Mesin'),
    ('304', 'FTI', '04', 'S1', 'Teknik Industri'),
    ('501', 'FTI', '01', 'D3', 'Teknik Komputer'),
    ('204', 'FTSP', '04', 'S1', 'Teknik Sipil'),
    ('214', 'FTSP', '14', 'S1', 'Arsitektur'),
    ('105', 'FPS', '05', 'S1', 'Psikologi'),
    ('108', 'FPS', '08', 'S1', 'Ilmu Komunikasi / Sastra Inggris'),
    ('702', 'FIKES', '02', 'S1', 'Farmasi'),
    ('404', 'FIKES', '04', 'S1', 'Agroteknologi'),
    ('712', 'FIKES', '12', 'S1', 'Kedokteran')
ON CONFLICT (prefix) DO UPDATE SET
    faculty_code = EXCLUDED.faculty_code,
    program_code = EXCLUDED.program_code,
    degree = EXCLUDED.degree,
    name = EXCLUDED.name;

CREATE TABLE IF NOT EXISTS users (
    id BIGSERIAL PRIMARY KEY,
    npm VARCHAR(8) NOT NULL UNIQUE
        CHECK (npm ~ '^[0-9]{8}$'),
    npm_prefix VARCHAR(3) GENERATED ALWAYS AS (substring(npm FROM 1 FOR 3)) STORED
        REFERENCES study_programs(prefix),
    entry_year SMALLINT GENERATED ALWAYS AS (2000 + substring(npm FROM 4 FOR 2)::INT) STORED,
    seq_number SMALLINT GENERATED ALWAYS AS (substring(npm FROM 6 FOR 3)::INT) STORED
        CHECK (seq_number BETWEEN 1 AND 999),
    full_name VARCHAR(100) NOT NULL CHECK (length(trim(full_name)) BETWEEN 2 AND 100),
    username VARCHAR(30) CHECK (username IS NULL OR username ~ '^[A-Za-z0-9_]{3,30}$'),
    phone VARCHAR(15) NOT NULL UNIQUE CHECK (phone ~ '^08[0-9]{8,11}$'),
    password_hash TEXT NOT NULL,
    avatar_url TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_users_username_ci
    ON users (lower(username)) WHERE username IS NOT NULL;

CREATE OR REPLACE FUNCTION validate_user_npm()
RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
    npm_year INT;
BEGIN
    IF NEW.npm !~ '^[0-9]{8}$' THEN
        RAISE EXCEPTION 'NPM harus terdiri dari tepat 8 digit'
            USING ERRCODE = '23514';
    END IF;
    npm_year := 2000 + substring(NEW.npm FROM 4 FOR 2)::INT;
    IF npm_year > EXTRACT(YEAR FROM CURRENT_DATE)::INT THEN
        RAISE EXCEPTION 'Tahun masuk pada NPM tidak valid'
            USING ERRCODE = '23514';
    END IF;
    IF substring(NEW.npm FROM 6 FOR 3)::INT = 0 THEN
        RAISE EXCEPTION 'Nomor urut NPM harus lebih besar dari 0'
            USING ERRCODE = '23514';
    END IF;
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS users_check_npm ON users;
CREATE TRIGGER users_check_npm
BEFORE INSERT OR UPDATE OF npm ON users
FOR EACH ROW EXECUTE FUNCTION validate_user_npm();

CREATE TABLE IF NOT EXISTS categories (
    id SERIAL PRIMARY KEY,
    name VARCHAR(100) NOT NULL UNIQUE,
    slug VARCHAR(120) NOT NULL UNIQUE
);

INSERT INTO categories (name, slug) VALUES
    ('Buku & Alat Tulis', 'buku-alat-tulis'),
    ('Elektronik', 'elektronik'),
    ('Perlengkapan Kos', 'perlengkapan-kos'),
    ('Fashion', 'fashion'),
    ('Kendaraan', 'kendaraan'),
    ('Lainnya', 'lainnya')
ON CONFLICT (slug) DO NOTHING;

CREATE TABLE IF NOT EXISTS listings (
    id BIGSERIAL PRIMARY KEY,
    seller_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    category_id INT NOT NULL REFERENCES categories(id),
    title VARCHAR(150) NOT NULL CHECK (length(trim(title)) BETWEEN 3 AND 150),
    description TEXT NOT NULL CHECK (length(trim(description)) BETWEEN 1 AND 5000),
    price NUMERIC(12, 0) NOT NULL CHECK (price >= 0),
    item_condition VARCHAR(20) NOT NULL
        CHECK (item_condition IN ('needs_repair', 'fair', 'good', 'like_new')),
    meetup_location VARCHAR(150),
    status VARCHAR(10) NOT NULL DEFAULT 'active'
        CHECK (status IN ('active', 'sold', 'hidden')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    sold_at TIMESTAMPTZ,
    CHECK ((status = 'sold' AND sold_at IS NOT NULL) OR status <> 'sold')
);

CREATE INDEX IF NOT EXISTS idx_listings_status_created ON listings (status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_listings_category ON listings (category_id);
CREATE INDEX IF NOT EXISTS idx_listings_seller ON listings (seller_id);

CREATE TABLE IF NOT EXISTS listing_images (
    id BIGSERIAL PRIMARY KEY,
    listing_id BIGINT NOT NULL REFERENCES listings(id) ON DELETE CASCADE,
    url TEXT NOT NULL,
    position SMALLINT NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS conversations (
    id BIGSERIAL PRIMARY KEY,
    listing_id BIGINT NOT NULL REFERENCES listings(id) ON DELETE CASCADE,
    buyer_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    seller_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (listing_id, buyer_id, seller_id),
    CHECK (buyer_id <> seller_id)
);

CREATE INDEX IF NOT EXISTS idx_conversations_participants
    ON conversations (buyer_id, seller_id, created_at DESC);

CREATE TABLE IF NOT EXISTS messages (
    id BIGSERIAL PRIMARY KEY,
    conversation_id BIGINT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
    sender_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    body VARCHAR(2000) NOT NULL CHECK (length(trim(body)) BETWEEN 1 AND 2000),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_messages_conversation
    ON messages (conversation_id, created_at);
