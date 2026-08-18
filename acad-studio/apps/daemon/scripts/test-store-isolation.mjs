/**
 * Chot: script kiem thu KHONG duoc dung kho du lieu that cua nguoi dung.
 *
 * Ngay 2026-08-17 mot script do hanh vi xoa da xoa ho so quy chuan THAT: no
 * truyen `{ dir }` thay vi `{ dataDir }`, ham giai duong dan bo qua khoa la trong
 * im lang roi lui ve `~/Library/Application Support/acad-studio`. Khong co ban
 * sao nao de lay lai.
 *
 * Hai ca, hai chot khac nhau — va ca thu hai moi la ca de xay ra hon:
 *   1. GO NHAM ten khoa  -> `resolveStandardsDataDir()` nem loi khoa la
 *   2. QUEN truyen han   -> `assertNotRealStoreInTests()` chan duong lui
 *
 * Chay: cd acad-studio/apps/daemon && npx tsx scripts/test-store-isolation.mjs
 */
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

process.env.ACAD_PROJECT_ROOT = new URL("../../../..", import.meta.url).pathname;
/* XOA hai bien nay truoc moi phep kiem.
   Neu moi truong da dat `ACAD_DATA_DIR`, cac loi goi "khong tuy chon" duoi day
   se tra ve duong dan do TRUOC khi cham toi chot — test do oan, va te hon la no
   co the tro vao mot kho that. Mot test phu thuoc trang thai moi truong thi
   khong chung minh duoc gi. */
delete process.env.ACAD_DATA_DIR;
delete process.env.MEP_DATA_DIR;

const profile = await import("../src/standardsProfile.ts");
const blocks = await import("../src/blockLibrary.ts");
const { LispLibrary } = await import("../src/lispLibrary.ts");

/* Ca 2 — QUEN truyen tuy chon. Moi thu hop le ve kieu, va duong lui dua thang
   vao du lieu that. Day la ca da gay ra mat mat. */
for (const [label, call] of [
  ["standards", () => profile.resolveStandardsDataDir()],
  ["block library", () => blocks.resolveBlockLibraryDataDir()],
  /* Kho thu vien LISP cung vay. Lan dau toi noi chot cho HAI kho trong khi chinh
     chu thich cua no viet "ca ba kho deu can" — chu thich khong ngan duoc bo sot,
     phep kiem thi co. */
  ["lisp library", () => new LispLibrary()],
]) {
  assert.throws(
    call,
    /kho du lieu that|kho dữ liệu thật/,
    `${label}: quen truyen dataDir trong script test phai bi CHAN, khong duoc lui ve kho that`,
  );
}

/* Ca 1 — go nham ten khoa. */
assert.throws(
  () => profile.resolveStandardsDataDir({ dir: "/tmp/x" }),
  /Tuỳ chọn kho không hợp lệ/,
  "khoa la phai bi tu choi",
);

/* Va duong DUNG van phai chay: mot chot chan het moi thu cung la mot chot hong. */
const temp = mkdtempSync(join(tmpdir(), "acad-isolation-"));
assert.equal(profile.resolveStandardsDataDir({ dataDir: temp }), temp);
assert.equal(blocks.resolveBlockLibraryDataDir({ dataDir: temp }), temp);
assert.equal(
  profile.resolveStandardsDataDir({ env: { ACAD_DATA_DIR: temp } }),
  temp,
  "bien moi truong cung la mot cach hop le",
);
assert.equal(new LispLibrary({ dataDir: temp }).dataDir, temp);
/* Va `ACAD_DATA_DIR` cua moi truong cung la duong hop le cho LispLibrary —
   nhieu script test dung cach nay thay vi truyen tuy chon. */
process.env.ACAD_DATA_DIR = temp;
assert.equal(new LispLibrary().dataDir, temp);
delete process.env.ACAD_DATA_DIR;

console.log("✓ store isolation: script test khong cham duoc kho that");
