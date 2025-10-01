import express from 'express';

const app = express();
app.use(express.json());

// Health endpoint
app.get('/api/healthz', (req, res) => {
  res.json({ ok: true, status: 'running', service: 'simple-forwarder' });
});

// Mock device data endpoint
app.get('/api/devicedatas', (req, res) => {
  res.json({ data: [] });
});

// Catch-all for other API requests
app.use('/api/*', (req, res) => {
  res.status(404).json({ error: 'Endpoint not implemented in simple forwarder' });
});

const PORT = 8089;
app.listen(PORT, () => {
  console.log(`Simple forwarder running on http://localhost:${PORT}`);
});
