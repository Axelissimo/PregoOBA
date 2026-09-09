function resendApiKey(): string {
  return String(process.env.RESEND_API_KEY ?? "").trim();
}

function orderEmailFrom(): string {
  const from = String(process.env.ORDER_EMAIL_FROM ?? "").trim();
  return from || "Prego B2B <prego.tilaukset@merconsult.fi>";
}

export function textToHtml(text: string): string {
  const escaped = text
    .replace(/&/g, "&#38;")
    .replace(/</g, "&#60;")
    .replace(/>/g, "&#62;")
    .replace(/\n/g, "<br/>\n");
  return (
    "<!DOCTYPE html><html><head><meta charset=\"utf-8\"/></head><body style=\"font-family:Arial,Helvetica,sans-serif;font-size:14px;line-height:1.45;color:#222\">" +
    escaped +
    "</body></html>"
  );
}

function parseTo(raw: string): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const part of raw.split(/[;,]/)) {
    const email = part.trim();
    const key = email.toLowerCase();
    if (!email || !email.includes("@") || seen.has(key)) continue;
    seen.add(key);
    out.push(email);
  }
  return out;
}

export async function sendResendEmail(input: {
  to: string;
  subject: string;
  text: string;
  html?: string;
  attachments?: { filename: string; content: string }[];
}): Promise<{ ok: boolean; error: string; from: string }> {
  const key = resendApiKey();
  const from = orderEmailFrom();
  if (!key) return { ok: false, error: "RESEND_API_KEY puuttuu Vercelistä", from };
  const to = parseTo(input.to);
  if (!to.length) return { ok: false, error: "Ei vastaanottajaa", from };
  const payload: Record<string, unknown> = {
    from,
    to: to.length === 1 ? to[0] : to,
    subject: input.subject,
    text: input.text,
    html: input.html || textToHtml(input.text),
  };
  if (input.attachments?.length) payload.attachments = input.attachments;
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: "Bearer " + key,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });
  const json = (await res.json().catch(() => ({}))) as { message?: string; name?: string };
  if (res.ok) return { ok: true, error: "", from };
  const error = (json.message || json.name || "Resend " + res.status) + " (from " + from + " → " + to.join(", ") + ")";
  console.error("[prego-email]", res.status, error);
  return { ok: false, error, from };
}

export async function sendSignupNotice(input: {
  adminTo: string;
  applicantEmail: string;
  displayName: string;
  companyName: string;
  vatNumber: string;
  phone: string;
  language?: string;
}): Promise<{ ok: boolean; error: string }> {
  const errors: string[] = [];
  const adminBody = [
    "Uusi yritystili odottaa hyv\u00e4ksynt\u00e4\u00e4.",
    "",
    "Yritys: " + (input.companyName || "-"),
    "Y-tunnus: " + (input.vatNumber || "-"),
    "Yhteyshenkil\u00f6: " + (input.displayName || "-"),
    "S\u00e4hk\u00f6posti: " + (input.applicantEmail || "-"),
    "Puhelin: " + (input.phone || "-"),
    "Kieli: " + (input.language || "fi"),
    "",
    "Hyv\u00e4ksy asiakas: https://prego.585.fi/admin",
  ].join("\n");
  const admin = await sendResendEmail({
    to: input.adminTo,
    subject: "Prego B2B: uusi tili " + (input.companyName || input.applicantEmail),
    text: adminBody,
  });
  if (!admin.ok) errors.push("myynti: " + admin.error);
  if (input.applicantEmail.includes("@")) {
    const copy = pendingCopy(input.language || "fi", input.displayName);
    const user = await sendResendEmail({
      to: input.applicantEmail,
      subject: copy.subject,
      text: copy.text,
    });
    if (!user.ok) errors.push("hakija: " + user.error);
  }
  return { ok: admin.ok, error: errors.join(" | ") };
}

function pendingCopy(raw: string, name: string): { subject: string; text: string } {
  const lang = (raw || "fi").toLowerCase().slice(0, 2);
  const who = (name || "").trim();
  const phone = "Olavi Barman, p. 0400 777 508";
  if (lang === "en") {
    return {
      subject: "Prego B2B: your account is awaiting approval",
      text: [
        "Hello " + (who || "there") + ",",
        "",
        "Thank you for opening a Prego B2B account.",
        "An administrator will review the company details. Prices and ordering open once the account is approved.",
        "",
        "If you are in a hurry, please call " + phone + ".",
        "",
        "Prego / Suomen 585 Oy",
      ].join("\n"),
    };
  }
  if (lang === "sv") {
    return {
      subject: "Prego B2B: ditt konto väntar på godkännande",
      text: [
        "Hej " + who + ",",
        "",
        "Tack för att du öppnade ett Prego B2B-konto.",
        "En administratör granskar företagsuppgifterna. Priser och beställning öppnas när kontot är godkänt.",
        "",
        "Om det är bråttom, ring " + phone + ".",
        "",
        "Prego / Suomen 585 Oy",
      ].join("\n"),
    };
  }
  if (lang === "no" || lang === "nb" || lang === "nn") {
    return {
      subject: "Prego B2B: kontoen din venter på godkjenning",
      text: [
        "Hei " + who + ",",
        "",
        "Takk for at du åpnet en Prego B2B-konto.",
        "En administrator sjekker firmadetaljene. Priser og bestilling åpnes når kontoen er godkjent.",
        "",
        "Hvis det haster, ring " + phone + ".",
        "",
        "Prego / Suomen 585 Oy",
      ].join("\n"),
    };
  }
  if (lang === "et") {
    return {
      subject: "Prego B2B: teie konto ootab kinnitust",
      text: [
        "Tere" + (who ? " " + who : "") + ",",
        "",
        "Täname Prego B2B konto avamise eest.",
        "Haldur kontrollib ettevõtte andmed. Hinnad ja tellimine avanevad pärast konto kinnitamist.",
        "",
        "Kui teil on kiire, helistage " + phone + ".",
        "",
        "Prego / Suomen 585 Oy",
      ].join("\n"),
    };
  }
  return {
    subject: "Prego B2B: tilisi odottaa hyväksyntää",
    text: [
      "Hei " + who + ",",
      "",
      "Kiitos Prego B2B -tilin avaamisesta.",
      "Ylläpitäjä tarkistaa yrityksen tiedot. Hinnat ja tilaus avautuvat, kun tili on hyväksytty.",
      "",
      "Jos sinulla on kiire, soita " + phone + ".",
      "",
      "Prego / Suomen 585 Oy",
    ].join("\n"),
  };
}

export async function sendAccountApprovedMail(input: {
  to: string;
  displayName: string;
  language: string;
}): Promise<{ ok: boolean; error: string }> {
  const copy = approvalCopy(input.language, input.displayName);
  return sendResendEmail({
    to: input.to,
    subject: copy.subject,
    text: copy.text,
  });
}

function approvalCopy(raw: string, name: string): { subject: string; text: string } {
  const lang = (raw || "fi").toLowerCase().slice(0, 2);
  const who = (name || "").trim();
  const login = "https://prego.585.fi/login";
  if (lang === "en") {
    return {
      subject: "Prego B2B: your account has been approved",
      text: [
        "Hello " + (who || "there") + ",",
        "",
        "Your company account on the Prego B2B portal has been approved.",
        "You can now sign in, see net prices and place orders.",
        "",
        "Sign in: " + login,
        "",
        "Prego / Suomen 585 Oy",
      ].join("\n"),
    };
  }
  if (lang === "sv") {
    return {
      subject: "Prego B2B: ditt konto har godkänts",
      text: [
        "Hej " + who + ",",
        "",
        "Ditt företagskonto i Prego B2B-portalen har godkänts.",
        "Du kan nu logga in, se nettopriser och lägga order.",
        "",
        "Logga in: " + login,
        "",
        "Prego / Suomen 585 Oy",
      ].join("\n"),
    };
  }
  if (lang === "no" || lang === "nb" || lang === "nn") {
    return {
      subject: "Prego B2B: kontoen din er godkjent",
      text: [
        "Hei " + who + ",",
        "",
        "Bedriftskontoen din i Prego B2B-portalen er godkjent.",
        "Du kan nå logge inn, se nettopriser og legge inn ordre.",
        "",
        "Logg inn: " + login,
        "",
        "Prego / Suomen 585 Oy",
      ].join("\n"),
    };
  }
  if (lang === "et") {
    return {
      subject: "Prego B2B: teie konto on kinnitatud",
      text: [
        "Tere" + (who ? " " + who : "") + ",",
        "",
        "Teie ettevõtte konto Prego B2B portaalis on kinnitatud.",
        "Nüüd saate sisse logida, näha netohindu ja esitada tellimusi.",
        "",
        "Logi sisse: " + login,
        "",
        "Prego / Suomen 585 Oy",
      ].join("\n"),
    };
  }
  return {
    subject: "Prego B2B: tilisi on hyväksytty",
    text: [
      "Hei " + who + ",",
      "",
      "Yritystilisi Prego B2B -portaalissa on hyväksytty.",
      "Voit nyt kirjautua, nähdä nettohinnat ja tehdä tilauksia.",
      "",
      "Kirjaudu: " + login,
      "",
      "Prego / Suomen 585 Oy",
    ].join("\n"),
  };
}

export async function sendPasswordResetMail(email: string, url: string) {
  const text = [
    "Hei,",
    "",
    "Pyysit uutta salasanaa Prego B2B -portaaliin.",
    "Avaa tämä linkki (voimassa rajoitetun ajan) ja aseta uusi salasana:",
    "",
    url,
    "",
    "Jos et pyytänyt tätä, voit jättää viestin huomiotta.",
    "",
    "Prego / Suomen 585 Oy",
  ].join("\n");
  const safeUrl = encodeURI(url);
  const html =
    "<!DOCTYPE html><html><head><meta charset=\"utf-8\"/></head><body style=\"font-family:Arial,Helvetica,sans-serif;font-size:14px;line-height:1.45;color:#222\">" +
    "<p>Hei,</p>" +
    "<p>Pyysit uutta salasanaa Prego B2B -portaaliin. Avaa linkki (voimassa rajoitetun ajan) ja aseta uusi salasana:</p>" +
    "<p><a href=\"" +
    safeUrl +
    "\">" +
    safeUrl +
    "</a></p>" +
    "<p>Jos et pyyt\u00e4nyt t\u00e4t\u00e4, voit j\u00e4tt\u00e4\u00e4 viestin huomiotta.</p>" +
    "<p>Prego / Suomen 585 Oy</p></body></html>";
  const sent = await sendResendEmail({
    to: email,
    subject: "Prego B2B: salasanan vaihto",
    text,
    html,
  });
  if (!sent.ok) {
    console.error("[prego-reset]", email, sent.error);
    throw new Error(sent.error || "Reset email failed");
  }
}
