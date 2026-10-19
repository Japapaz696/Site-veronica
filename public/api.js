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

// Disponivel no navegador (script classico) e no Node, para os testes.
const api = { API_BASE, apiRequest, apiGet, apiPost, apiPut, apiDelete };

if (typeof window !== 'undefined') {
    window.api = api;
    window.apiRequest = apiRequest;
    window.apiGet = apiGet;
    window.apiPost = apiPost;
    window.apiPut = apiPut;
    window.apiDelete = apiDelete;
}

if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
}
