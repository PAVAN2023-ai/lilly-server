const express = require('express');
const cors = require('cors');

const app = express();
app.use(cors({ origin: '*' }));
app.use(express.json());

const ANTHROPIC_KEY = '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';
const gmailAccounts = {};

app.get('/', (req, res) => {
  res.json({ status: 'Lilly Server Online', accounts: Object.keys(gmailAccounts).length });
});

app.post('/api/ask', async (req, res) => {
  try {
    const { message, history, lang } = req.body;
    const langNames = { 'en-IN': 'English', 'kn-IN': 'Kannada', 'te-IN': 'Telugu', 'hi-IN': 'Hindi' };
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': ANTHROPIC_KEY,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-6',
        max_tokens: 800,
        system: `You are Lilly, a warm personal AI assistant for Pavan in Bengaluru India. Always respond in ${langNames[lang]||'English'} only. Keep answers 2-3 sentences. Address user as Pavan.`,
        messages: [...(history||[]), { role: 'user', content: message }]
      })
    });
    const data = await response.json();
    if (data.error) return res.status(500).json({ error: data.error.message });
    res.json({ reply: data.content[0].text });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.post('/api/gmail/save', async (req, res) => {
  const { email, token, color } = req.body;
  if (!email || !token) return res.status(400).json({ error: 'Missing data' });
  gmailAccounts[email] = { email, token, color: color||'#00ffcc' };
  res.json({ success: true });
});

app.get('/api/gmail/accounts', (req, res) => {
  res.json({ accounts: Object.values(gmailAccounts).map(a => ({ email: a.email, color: a.color })) });
});

app.delete('/api/gmail/remove/:email', (req, res) => {
  delete gmailAccounts[decodeURIComponent(req.params.email)];
  res.json({ success: true });
});

app.post('/api/gmail/mail', async (req, res) => {
  try {
    const { email } = req.body;
    const acct = gmailAccounts[email];
    if (!acct) return res.status(404).json({ error: 'Account not found. Please reconnect Gmail.' });
    const now = new Date();
    const after = Math.floor(new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime()/1000);
    const listRes = await fetch(`https://gmail.googleapis.com/gmail/v1/users/me/messages?maxResults=20&q=after:${after}`,
      { headers: { Authorization: `Bearer ${acct.token}` } });
    if (listRes.status === 401) {
      delete gmailAccounts[email];
      return res.status(401).json({ error: 'Gmail session expired. Please reconnect.' });
    }
    const listData = await listRes.json();
    if (!listData.messages || listData.messages.length === 0)
      return res.json({ emails: [], total: 0, unread: 0, email });
    const emails = [];
    for (const msg of listData.messages.slice(0, 12)) {
      const det = await fetch(`https://gmail.googleapis.com/gmail/v1/users/me/messages/${msg.id}?format=metadata&metadataHeaders=From&metadataHeaders=Subject`,
        { headers: { Authorization: `Bearer ${acct.token}` } });
      const d = await det.json();
      const h = d.payload?.headers || [];
      const gh = n => h.find(x => x.name===n)?.value||'';
      emails.push({
        from: gh('From').replace(/<.*>/,'').replace(/"/g,'').trim()||'Unknown',
        subject: gh('Subject')||'(no subject)',
        isUnread: (d.labelIds||[]).includes('UNREAD'),
        snippet: (d.snippet||'').substring(0,100)
      });
    }
    res.json({ emails, total: listData.messages.length, unread: emails.filter(e=>e.isUnread).length, email });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Railway requires listening on 0.0.0.0
const PORT = process.env.PORT || 3000;
app.listen(PORT, '0.0.0.0', () => {
  console.log(`Lilly Server running on port ${PORT}`);
});
