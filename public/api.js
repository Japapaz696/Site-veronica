// === CLIENTE DA API ===
//
// Autenticação administrativa usa cookie de sessão HttpOnly: o JavaScript nunca
// lê nem guarda a senha. A exclusão pelo paciente usa um token opaco.
//
// Este arquivo é carregado antes de `script.js` nas páginas que falam com a
// API. Fica separado para poder ser testado sem navegador.

const API_BASE = ''; // same origin

/**
 * Requisição à API com tratamento de erro consistente.
 *
 * A mensagem do servidor é preservada em todas as chamadas. Antes, o `apiGet`
 * jogava fora a mensagem e devolvia só "API error: 409", o que fazia o
 * agendamento mostrar um erro genérico no lugar de "horário já ocupado".
 */
async function apiRequest(path, { method = 'GET', data, token } = {}) {
    const headers = {};
    if (data !== undefined) {
        headers['Content-Type'] = 'application/json';
    }
    if (token) {
        headers['Authorization'] = 'Bearer ' + token;
    }

    const opcoes = {
        method,
        credentials: 'same-origin',
        headers
    };
    if (data !== undefined) {
        opcoes.body = JSON.stringify(data);
    }

    let response;
    try {
        response = await fetch(API_BASE + path, opcoes);
    } catch (erro) {
        // Falha de rede: não há resposta do servidor para interpretar.
        const falha = new Error('Não foi possível falar com o servidor. Verifique sua conexão.');
        falha.status = 0;
        falha.causa = erro;
        throw falha;
    }

    if (response.status === 204) {
        return undefined;
    }

    if (!response.ok) {
        const corpo = await response.json().catch(() => null);
        const erro = new Error(
            (corpo && corpo.error) || `Erro ${response.status} ao falar com o servidor.`
        );
        erro.status = response.status;
        throw erro;
    }

    return response.json();
}

async function apiGet(path) {
    return apiRequest(path);
}

async function apiPost(path, data) {
    return apiRequest(path, { method: 'POST', data });
}

async function apiPut(path, data) {
    return apiRequest(path, { method: 'PUT', data });
}

async function apiDelete(path, token) {
    return apiRequest(path, { method: 'DELETE', token });
}

// === ESCAPE DE DADOS NÃO CONFIÁVEIS ===
//
// Os agendamentos chegam pelo formulário público: nome, telefone, e-mail e
// observação são digitados por qualquer visitante. Toda vez que um desses
// valores entra em `innerHTML` (cards do painel, timeline, modal de detalhes,
// página "meus agendamentos") ele vira HTML se não for escapado — é a falha de
// XSS armazenado. Escapar na saída é a correção certa: o dado continua íntegro
// na API e só é neutralizado no momento de renderizar.

/**
 * Escapa uma string para uso seguro dentro de HTML.
 *
 * Cobre os cinco caracteres que importam para sair de um nó de texto ou de um
 * valor de atributo entre aspas: `&`, `<`, `>`, `"` e `'`. A ordem importa —
 * o `&` precisa ser o primeiro para não reescapar as entidades geradas.
 */
function escapeHtml(valor) {
    if (valor === null || valor === undefined) {
        return '';
    }
    return String(valor)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

/**
 * Escapa um valor para uso como argumento literal dentro de um atributo de
 * evento inline (`onclick="...('valor')"`).
 *
 * Aspas simples são o delimitador do argumento, então escapá-las via
 * `escapeHtml` já impede o fechamento da string. O escape adicional de barra
 * invertida e de quebras de linha evita que o valor monte uma segunda instrução
 * JavaScript. Preferir sempre `data-*` + `addEventListener` quando possível.
 */
function escapeJsAttr(valor) {
    if (valor === null || valor === undefined) {
        return '';
    }
    return escapeHtml(valor)
        .replace(/\\/g, '&#92;')
        .replace(/\r/g, '&#13;')
        .replace(/\n/g, '&#10;');
}

// Disponivel no navegador (script classico) e no Node, para os testes.
const api = {
    API_BASE,
    apiRequest,
    apiGet,
    apiPost,
    apiPut,
    apiDelete,
    escapeHtml,
    escapeJsAttr,
};

if (typeof window !== 'undefined') {
    window.api = api;
    window.apiRequest = apiRequest;
    window.apiGet = apiGet;
    window.apiPost = apiPost;
    window.apiPut = apiPut;
    window.apiDelete = apiDelete;
    window.escapeHtml = escapeHtml;
    window.escapeJsAttr = escapeJsAttr;
}

if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
}
