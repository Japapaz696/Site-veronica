// ===== ESTADO DO AGENDAMENTO =====
let agendamentoAtual = {
    tipo: null,           // 'online' | 'presencial'
    data: null,          // '2026-08-26'
    hora: null,          // '10:00'
    nome: '',
    email: '',
    telefone: '',
    mensagem: ''
};

let etapaAtual = 1;
let mesAtual = new Date().getMonth();
let anoAtual = new Date().getFullYear();

// ===== HORÁRIOS DISPONÍVEIS =====
const horariosDisponiveis = {
    0: [], // Domingo - não atende
    1: ['09:00', '10:00', '11:00', '14:00', '15:00', '16:00', '17:00'], // Segunda
    2: ['09:00', '10:00', '11:00', '14:00', '15:00', '16:00', '17:00'], // Terça
    3: ['09:00', '10:00', '11:00', '14:00', '15:00', '16:00', '17:00'], // Quarta
    4: ['09:00', '10:00', '11:00', '14:00', '15:00', '16:00', '17:00'], // Quinta
    5: ['09:00', '10:00', '11:00', '14:00', '15:00', '16:00'], // Sexta
    6: [] // Sábado - não atende
};

// ===== FUNÇÕES AUXILIARES =====
function formatarData(dataStr) {
    const data = new Date(dataStr + 'T00:00:00');
    return data.toLocaleDateString('pt-BR', {
        day: '2-digit',
        month: 'long',
        year: 'numeric'
    });
}

function formatarDataCurta(dataStr) {
    const data = new Date(dataStr + 'T00:00:00');
    return data.toLocaleDateString('pt-BR', {
        day: '2-digit',
        month: '2-digit',
        year: 'numeric'
    });
}

// Helper functions for API calls (with localStorage fallback for development)
async function obterHorariosOcupados() {
    try {
        const occupiedSlots = await apiGet('/api/ocupados');
        return occupiedSlots;
    } catch (error) {
        console.warn('API não disponível, usando localStorage:', error);
        const agendamentos = localStorage.getItem('agendamentos');
        return agendamentos ? JSON.parse(agendamentos).map(ag => ag.data + 'T' + ag.hora) : [];
    }
}

function verificarHorarioDisponivel(data, hora) {
    return new Promise(async (resolve) => {
        const occupiedSlots = await obterHorariosOcupados();
        const slot = data + 'T' + hora;
        resolve(!occupiedSlots.includes(slot));
    });
}

// Helper function to format local date to ISO date string
function formatarDataParaISO(data) {
    return data.toISOString().split('T')[0];
}

// ===== ETAPA 1: TIPO DE ATENDIMENTO =====
document.querySelectorAll('.tipo-card').forEach(card => {
    card.addEventListener('click', () => {
        // Remove seleção anterior
        document.querySelectorAll('.tipo-card').forEach(c => c.classList.remove('selecionado'));

        // Adiciona seleção
        card.classList.add('selecionado');
        agendamentoAtual.tipo = card.dataset.tipo;

        // Habilita botão avançar
        document.getElementById('btn-avancar').disabled = false;
    });
});

// ===== ETAPA 2: CALENDÁRIO =====
function renderizarCalendario(mes, ano) {
    const diasContainer = document.getElementById('calendario-dias');
    const tituloMesAno = document.getElementById('calendario-mes-ano');

    // Limpar dias anteriores
    diasContainer.innerHTML = '';

    // Atualizar título
    const meses = ['Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho',
                   'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro'];
    tituloMesAno.textContent = `${meses[mes]} ${ano}`;

    // Primeiro dia do mês e total de dias
    const primeiroDia = new Date(ano, mes, 1).getDay();
    const totalDias = new Date(ano, mes + 1, 0).getDate();

    // Data de hoje
    const hoje = new Date();
    hoje.setHours(0, 0, 0, 0);

    // Adicionar dias vazios do início
    for (let i = 0; i < primeiroDia; i++) {
        const diaVazio = document.createElement('div');
        diaVazio.className = 'calendario-dia vazio';
        diasContainer.appendChild(diaVazio);
    }

    // Adicionar dias do mês
    for (let dia = 1; dia <= totalDias; dia++) {
        const diaData = new Date(ano, mes, dia);
        diaData.setHours(0, 0, 0, 0);
        const diaSemana = diaData.getDay();
        const dataStr = `${ano}-${String(mes + 1).padStart(2, '0')}-${String(dia).padStart(2, '0')}`;

        const diaEl = document.createElement('button');
        diaEl.className = 'calendario-dia';
        diaEl.textContent = dia;
        diaEl.setAttribute('data-data', dataStr);

        // Verificar se é passado
        if (diaData < hoje) {
            diaEl.classList.add('passado');
            diaEl.disabled = true;
        }
        // Verificar se não atende nesse dia (domingo ou sábado)
        else if (horariosDisponiveis[diaSemana].length === 0) {
            diaEl.classList.add('indisponivel');
            diaEl.disabled = true;
        }
        // Dia disponível
        else {
            diaEl.classList.add('disponivel');
            diaEl.addEventListener('click', () => selecionarData(dataStr));
        }

        // Marcar se está selecionado
        if (agendamentoAtual.data === dataStr) {
            diaEl.classList.add('selecionado');
        }

        diasContainer.appendChild(diaEl);
    }
}

function selecionarData(dataStr) {
    // Remover seleção anterior
    document.querySelectorAll('.calendario-dia').forEach(d => d.classList.remove('selecionado'));

    // Adicionar seleção
    const diaEl = document.querySelector(`[data-data="${dataStr}"]`);
    if (diaEl) {
        diaEl.classList.add('selecionado');
    }

    agendamentoAtual.data = dataStr;
    document.getElementById('btn-avancar').disabled = false;
}

// Navegação entre meses
document.getElementById('mes-anterior').addEventListener('click', () => {
    mesAtual--;
    if (mesAtual < 0) {
        mesAtual = 11;
        anoAtual--;
    }
    renderizarCalendario(mesAtual, anoAtual);
});

document.getElementById('mes-proximo').addEventListener('click', () => {
    mesAtual++;
    if (mesAtual > 11) {
        mesAtual = 0;
        anoAtual++;
    }
    renderizarCalendario(mesAtual, anoAtual);
});

// ===== ETAPA 3: HORÁRIOS =====
async function renderizarHorarios() {
    const dataSelecionada = new Date(agendamentoAtual.data + 'T00:00:00');
    const diaSemana = dataSelecionada.getDay();
    const horarios = horariosDisponiveis[diaSemana];

    // Atualizar display da data
    document.getElementById('data-selecionada-display').textContent =
        `Horários disponíveis para ${formatarData(agendamentoAtual.data)}`;

    const containerManha = document.getElementById('horarios-manha');
    const containerTarde = document.getElementById('horarios-tarde');

    containerManha.innerHTML = '';
    containerTarde.innerHTML = '';

    const occupiedSlots = await obterHorariosOcupados();

    horarios.forEach(hora => {
        const [h] = hora.split(':').map(Number);
        const container = h < 12 ? containerManha : containerTarde;

        const horarioBtn = document.createElement('button');
        horarioBtn.className = 'horario-btn';
        horarioBtn.textContent = hora;

        const disponivel = !occupiedSlots.includes(agendamentoAtual.data + 'T' + hora);

        if (!disponivel) {
            horarioBtn.classList.add('ocupado');
            horarioBtn.disabled = true;
            horarioBtn.innerHTML = `${hora} <span style="font-size: 0.75rem; display: block;">Ocupado</span>`;
        } else {
            horarioBtn.addEventListener('click', () => selecionarHorario(hora, horarioBtn));
        }

        if (agendamentoAtual.hora === hora) {
            horarioBtn.classList.add('selecionado');
        }

        container.appendChild(horarioBtn);
    });
}

function selecionarHorario(hora, btn) {
    // Remover seleção anterior
    document.querySelectorAll('.horario-btn').forEach(btn => btn.classList.remove('selecionado'));

    // Adicionar seleção
    if (btn) {
        btn.classList.add('selecionado');
    }

    agendamentoAtual.hora = hora;
    document.getElementById('btn-avancar').disabled = false;
}

// ===== ETAPA 4: CONFIRMAÇÃO =====
function atualizarResumo() {
    const tipoTexto = agendamentoAtual.tipo === 'online' ? '💻 Online' : '🏢 Presencial';

    document.getElementById('resumo-tipo').textContent = tipoTexto;
    document.getElementById('resumo-data').textContent = formatarData(agendamentoAtual.data);
    document.getElementById('resumo-horario').textContent = agendamentoAtual.hora;
}

function validarFormulario() {
    let valido = true;

    // Nome
    const nome = document.getElementById('nome').value.trim();
    if (nome.length < 3) {
        document.getElementById('erro-nome').textContent = 'Nome deve ter pelo menos 3 caracteres';
        valido = false;
    } else {
        document.getElementById('erro-nome').textContent = '';
        agendamentoAtual.nome = nome;
    }

    // Email
    const email = document.getElementById('email').value.trim();
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
        document.getElementById('erro-email').textContent = 'Email inválido';
        valido = false;
    } else {
        document.getElementById('erro-email').textContent = '';
        agendamentoAtual.email = email;
    }

    // Telefone
    const telefone = document.getElementById('telefone').value.trim();
    const telefoneRegex = /^\(?[1-9]{2}\)?\s?9?\d{4}-?\d{4}$/;
    if (!telefoneRegex.test(telefone.replace(/\s/g, ''))) {
        document.getElementById('erro-telefone').textContent = 'Telefone inválido';
        valido = false;
    } else {
        document.getElementById('erro-telefone').textContent = '';
        agendamentoAtual.telefone = telefone;
    }

    // Mensagem (opcional)
    agendamentoAtual.mensagem = document.getElementById('mensagem').value.trim();

    return valido;
}

// ===== NAVEGAÇÃO ENTRE ETAPAS =====
function navegarParaEtapa(etapa) {
    // Atualizar indicadores
    document.querySelectorAll('.etapa').forEach(el => {
        const numEtapa = parseInt(el.dataset.etapa);
        el.classList.remove('etapa-ativa', 'etapa-concluida');

        if (numEtapa === etapa) {
            el.classList.add('etapa-ativa');
        } else if (numEtapa < etapa) {
            el.classList.add('etapa-concluida');
        }
    });

    // Atualizar conteúdos
    document.querySelectorAll('.etapa-conteudo').forEach(el => {
        el.classList.remove('etapa-ativa');
    });
    document.getElementById(`etapa-${etapa}`).classList.add('etapa-ativa');

    // Atualizar botões
    const btnVoltar = document.getElementById('btn-voltar');
    const btnAvancar = document.getElementById('btn-avancar');
    const btnConfirmar = document.getElementById('btn-confirmar');

    btnVoltar.style.display = etapa > 1 ? 'inline-block' : 'none';

    if (etapa === 4) {
        btnAvancar.style.display = 'none';
        btnConfirmar.style.display = 'inline-block';
        atualizarResumo();
    } else {
        btnAvancar.style.display = 'inline-block';
        btnConfirmar.style.display = 'none';
        btnAvancar.disabled = true;
    }

    // Ações específicas por etapa
    if (etapa === 1 && agendamentoAtual.tipo) {
        btnAvancar.disabled = false;
    } else if (etapa === 2) {
        renderizarCalendario(mesAtual, anoAtual);
        if (agendamentoAtual.data) {
            btnAvancar.disabled = false;
        }
    } else if (etapa === 3) {
        renderizarHorarios();
        if (agendamentoAtual.hora) {
            btnAvancar.disabled = false;
        }
    }

    etapaAtual = etapa;

    // Scroll para o topo
    window.scrollTo({ top: 0, behavior: 'smooth' });
}

// Botão Avançar
document.getElementById('btn-avancar').addEventListener('click', () => {
    if (etapaAtual < 4) {
        navegarParaEtapa(etapaAtual + 1);
    }
});

// Botão Voltar
document.getElementById('btn-voltar').addEventListener('click', () => {
    if (etapaAtual > 1) {
        navegarParaEtapa(etapaAtual - 1);
    }
});

// ===== CONFIRMAÇÃO DO AGENDAMENTO =====
document.getElementById('btn-confirmar').addEventListener('click', async () => {
    if (!validarFormulario()) {
        mostrarToast('Por favor, corrija os erros no formulário', 'error');
        return;
    }

    // Salvar agendamento via API
    try {
        const novoAgendamento = {
            ...agendamentoAtual,
            id: Date.now(),
            criadoEm: new Date().toISOString()
        };

        const criado = await apiPost('/api/agendamentos', novoAgendamento);

        const meusIds = JSON.parse(localStorage.getItem('meus_agendamento_ids') || '[]');
        meusIds.push(criado.id);
        localStorage.setItem('meus_agendamento_ids', JSON.stringify(meusIds));

        mostrarModalSucesso();
    } catch (error) {
        const msg = (error && error.message) || '';
        if (msg.toLowerCase().includes('ocupado')) {
            mostrarToast('Horário já ocupado! Por favor, escolha outro horário.', 'error');
        } else {
            mostrarToast('Erro ao salvar agendamento. O servidor está rodando?', 'error');
        }
        console.error('Erro ao salvar agendamento:', error);
    }
});

function mostrarModalSucesso() {
    const modal = document.getElementById('modal-sucesso');
    const tipoTexto = agendamentoAtual.tipo === 'online' ? '💻 Atendimento Online' : '🏢 Atendimento Presencial';

    document.getElementById('modal-tipo').textContent = tipoTexto;
    document.getElementById('modal-data').textContent = formatarData(agendamentoAtual.data);
    document.getElementById('modal-horario').textContent = agendamentoAtual.hora;

    modal.style.display = 'flex';

    // Preparar botão WhatsApp
    const btnWhatsApp = document.getElementById('btn-whatsapp-modal');
    btnWhatsApp.onclick = () => {
        const mensagem = `Olá, Veronica Reis Santana da Paz! Gostaria de confirmar meu agendamento:

📅 Data: ${formatarDataCurta(agendamentoAtual.data)}
⏰ Horário: ${agendamentoAtual.hora}
💻 Tipo: ${agendamentoAtual.tipo === 'online' ? 'Online' : 'Presencial'}

👤 Nome: ${agendamentoAtual.nome}
📧 Email: ${agendamentoAtual.email}
📱 Telefone: ${agendamentoAtual.telefone}

${agendamentoAtual.mensagem ? '💬 Observação: ' + agendamentoAtual.mensagem : ''}`;

        const url = `https://wa.me/5531988836237?text=${encodeURIComponent(mensagem)}`;
        window.open(url, '_blank');
    };
}

// Fechar modal ao clicar fora
document.getElementById('modal-sucesso').addEventListener('click', (e) => {
    if (e.target.id === 'modal-sucesso') {
        e.target.style.display = 'none';
    }
});

// ===== MÁSCARA DE TELEFONE =====
document.getElementById('telefone').addEventListener('input', (e) => {
    let valor = e.target.value.replace(/\D/g, '');

    if (valor.length <= 11) {
        valor = valor.replace(/^(\d{2})(\d)/g, '($1) $2');
        valor = valor.replace(/(\d)(\d{4})$/, '$1-$2');
    }

    e.target.value = valor;
});

// ===== INICIALIZAÇÃO =====
document.addEventListener('DOMContentLoaded', () => {
    navegarParaEtapa(1);
    console.log('📅 Sistema de agendamento carregado!');
});
