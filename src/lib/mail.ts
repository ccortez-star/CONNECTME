export async function sendConfirmationEmail(input: {
  to: string;
  subject: string;
  text: string;
}) {
  const key = process.env.RESEND_API_KEY;
  if (!key) {
    console.info("[email:dev]", input.to, input.subject, input.text);
    return;
  }
  await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from: process.env.EMAIL_FROM ?? "noreply@example.com",
      to: input.to,
      subject: input.subject,
      text: input.text,
    }),
  });
}
