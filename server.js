const express = require('express');
const path = require('path');
const fs = require('fs').promises;
const app = express();

app.use(express.json());
app.get('/admin', (req, res) => res.sendFile(path.join(__dirname, 'admin.html')));
app.use(express.static(path.join(__dirname)));

// Data file path
const DATA_FILE = path.join(__dirname, 'data', 'agendamentos.json');

// Helper: read data
async function readData() {
  try {
    const data = await fs.readFile(DATA_FILE, 'utf8');
    return JSON.parse(data);
  } catch (err) {
    // File doesn't exist or is empty - create empty array
    if (err.code === 'ENOENT' || err.message.includes('No such file or directory')) {
      await fs.mkdir(path.dirname(DATA_FILE), { recursive: true });
      await fs.writeFile(DATA_FILE, '[]', 'utf8');
      return [];
    }
    throw err;
  }
}

// Helper: write data
async function writeData(data) {
  await fs.writeFile(DATA_FILE, JSON.stringify(data, null, 2), 'utf8');
}

// GET /api/ocupados - returns available slots (data + hora)
app.get('/api/ocupados', async (req, res) => {
  const agendamentos = await readData();
  const slots = new Set();
  agendamentos.forEach(ag => {
    slots.add(ag.data + 'T' + ag.hora);
  });
  res.json([...slots]);
});

// GET /api/agendamentos/por-ids?ids=1,2,3 — paciente vê só os próprios
app.get('/api/agendamentos/por-ids', async (req, res) => {
  const ids = String(req.query.ids || '')
    .split(',')
    .map((id) => Number(id))
    .filter((id) => Number.isFinite(id) && id > 0);

  const agendamentos = await readData();
  res.json(agendamentos.filter((ag) => ids.includes(ag.id)));
});

// POST /api/agendamentos - create new appointment
app.post('/api/agendamentos', async (req, res) => {
  const { nome, tipo, data, hora, email, telefone, mensagem, confirmado } = req.body;

  if (!nome || !tipo || !data || !hora) {
    return res.status(400).json({ error: 'Todos os campos são obrigatórios' });
  }

  if (!['online', 'presencial'].includes(tipo)) {
    return res.status(400).json({ error: 'Tipo inválido' });
  }

  const agendamentos = await readData();

  const existing = agendamentos.find((ag) => ag.data === data && ag.hora === hora);
  if (existing) {
    return res.status(409).json({ error: 'Horário já ocupado' });
  }

  const newAppointment = {
    id: Date.now(),
    nome,
    tipo,
    data,
    hora,
    email: email || '',
    telefone: telefone || '',
    mensagem: mensagem || '',
    confirmado: !!confirmado,
    criadoEm: new Date().toISOString()
  };

  agendamentos.push(newAppointment);
  await writeData(agendamentos);

  res.status(201).json(newAppointment);
});

// GET /api/agendamentos - admin only
app.get('/api/agendamentos', async (req, res) => {
  const adminPassword = req.headers['x-admin-password'];
  if (adminPassword !== 'veronica2026') {
    return res.status(401).json({ error: 'Não autorizado' });
  }

  const agendamentos = await readData();
  res.json(agendamentos);
});

// PUT /api/agendamentos/:id - admin only
app.put('/api/agendamentos/:id', async (req, res) => {
  const adminPassword = req.headers['x-admin-password'];
  if (adminPassword !== 'veronica2026') {
    return res.status(401).json({ error: 'Não autorizado' });
  }

  const id = parseInt(req.params.id);
  const { nome, tipo, data, hora, mensagem, confirmado } = req.body;

  if (!nome || !tipo || !data || !hora) {
    return res.status(400).json({ error: 'Todos os campos são obrigatórios' });
  }

  const agendamentos = await readData();
  const index = agendamentos.findIndex((ag) => ag.id === id);
  if (index === -1) {
    return res.status(404).json({ error: 'Agendamento não encontrado' });
  }

  const conflito = agendamentos.find((ag) => ag.id !== id && ag.data === data && ag.hora === hora);
  if (conflito) {
    return res.status(409).json({ error: 'Horário já ocupado' });
  }

  agendamentos[index] = {
    ...agendamentos[index],
    nome,
    tipo,
    data,
    hora,
    email: req.body.email !== undefined ? req.body.email : agendamentos[index].email,
    telefone: req.body.telefone !== undefined ? req.body.telefone : agendamentos[index].telefone,
    mensagem: mensagem || '',
    confirmado: confirmado !== undefined ? confirmado : agendamentos[index].confirmado
  };

  await writeData(agendamentos);
  res.json(agendamentos[index]);
});

// DELETE /api/agendamentos/:id - admin only
app.delete('/api/agendamentos/:id', async (req, res) => {
  const adminPassword = req.headers['x-admin-password'];
  if (adminPassword !== 'veronica2026') {
    return res.status(401).json({ error: 'Não autorizado' });
  }

  const id = parseInt(req.params.id);
  const agendamentos = await readData();
  const index = agendamentos.findIndex(ag => ag.id === id);
  if (index === -1) {
    return res.status(404).json({ error: 'Agendamento não encontrado' });
  }

  agendamentos.splice(index, 1);
  await writeData(agendamentos);
  res.status(204).send();
});

// Start server
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Servidor rodando em http://localhost:${PORT}`);
  console.log(`Arquivos estáticos servidos de: ${path.join(__dirname)}`);
  console.log(`API disponível em: http://localhost:${PORT}/api/*`);
});