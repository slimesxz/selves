const functions = require("firebase-functions");
const admin = require("firebase-admin");
const { Resend } = require("resend");
const fs = require("fs");

admin.initializeApp();
const db = admin.firestore();
const resend = new Resend("re_5iPnzUwA_HnS7tWyRr25jUMwtSygDpacP");

const REFERRAL_BOOST_MS = 5 * 60 * 60 * 1000; // 5 hours in ms

function generateCode() {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let code = "";
  for (let i = 0; i < 6; i++) {
    code += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return code;
}

function emailTemplate(code, position) {
  const html = fs.readFileSync(__dirname + "/email.html", "utf8");
  return html
    .replace(/\{\{CODE\}\}/g, code)
    .replace(/\{\{POSITION\}\}/g, position)
    .replace(/selves\.id\?ref=/g, "selves.id/ref/?code=")
    .replace(/selves\.id\/ref\//g, "selves.id/ref/?code=");
}

function computeQueueScore(createdAt, referralCount) {
  const base = createdAt instanceof Date
    ? createdAt.getTime()
    : createdAt.toMillis();
  return base - (referralCount * REFERRAL_BOOST_MS);
}

exports.waitlistEmail = functions.https.onRequest(async (req, res) => {
  res.set("Access-Control-Allow-Origin", "*");
  if (req.method === "OPTIONS") {
    res.set("Access-Control-Allow-Methods", "POST");
    res.set("Access-Control-Allow-Headers", "Content-Type");
    return res.status(204).send("");
  }

  const email = req.body.email;
  const ref = req.body.ref || null;

  try {
    const existing = await db.collection("waitlist").where("email", "==", email).get();
    if (!existing.empty) {
      return res.status(200).send("duplicate");
    }

    const code = generateCode();
    const createdAt = new Date();
    const initialQueueScore = computeQueueScore(createdAt, 0);

    await db.collection("waitlist").add({
      email,
      code,
      referredBy: ref,
      referralCount: 0,
      queueScore: initialQueueScore,
      createdAt,
      status: "waitlisted"
    });

    if (ref) {
      const referrerSnap = await db
        .collection("waitlist")
        .where("code", "==", ref)
        .get();

      if (!referrerSnap.empty) {
        const referrerDoc = referrerSnap.docs[0];
        const referrerData = referrerDoc.data();
        const newReferralCount = (referrerData.referralCount || 0) + 1;
        const newQueueScore = computeQueueScore(referrerData.createdAt, newReferralCount);

        await db.collection("connections").add({
          from: referrerData.email,
          to: email,
          fromCode: ref,
          status: "pending",
          createdAt: new Date()
        });

        await referrerDoc.ref.update({
          referralCount: admin.firestore.FieldValue.increment(1),
          queueScore: newQueueScore
        });
      }
    }

    // compute position for the new signup
    const aheadSnap = await db
      .collection("waitlist")
      .where("queueScore", "<", initialQueueScore)
      .get();
    const position = aheadSnap.size + 1;

    await resend.emails.send({
      from: "Selves <info@selves.id>",
      to: email,
      subject: "Know yourself.",
      html: emailTemplate(code, position)
    });

    await resend.emails.send({
      from: "Selves <info@selves.id>",
      to: "info@selves.id",
      subject: "New signup",
      html: "<p>" + email + " — code: " + code + "</p>"
    });

    res.status(200).send("ok");

  } catch (err) {
    console.error("waitlistEmail error:", err);
    res.status(500).send(err.toString());
  }
});

exports.getPositionByCode = functions.https.onRequest(async (req, res) => {
  res.set("Access-Control-Allow-Origin", "*");
  if (req.method === "OPTIONS") {
    res.set("Access-Control-Allow-Methods", "GET");
    res.set("Access-Control-Allow-Headers", "Content-Type");
    return res.status(204).send("");
  }

  const code = (req.query.code || "").trim().toUpperCase();

  if (!code) {
    return res.status(400).json({ error: "code required" });
  }

  try {
    const snap = await db
      .collection("waitlist")
      .where("code", "==", code)
      .limit(1)
      .get();

    if (snap.empty) {
      return res.status(404).json({ error: "code not found" });
    }

    const referrerData = snap.docs[0].data();
    const referrerScore = referrerData.queueScore
      ?? computeQueueScore(referrerData.createdAt, referrerData.referralCount || 0);

    // Position = number of people with a lower (better) queueScore + 1
    const aheadSnap = await db
      .collection("waitlist")
      .where("queueScore", "<", referrerScore)
      .get();

    const position = aheadSnap.size + 1;

    return res.status(200).json({ position, code });

  } catch (err) {
    console.error("getPositionByCode error:", err);
    return res.status(500).json({ error: "internal error" });
  }
});
