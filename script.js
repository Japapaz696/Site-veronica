// ===== MENU MOBILE =====
const menuToggle = document.querySelector('.menu-toggle');
const navLinks = document.querySelector('.nav-links');

if (menuToggle) {
    menuToggle.addEventListener('click', () => {
        navLinks.classList.toggle('active');
        const isExpanded = navLinks.classList.contains('active');
        menuToggle.setAttribute('aria-expanded', isExpanded);

        // Animar hambúrguer para X
        const spans = menuToggle.querySelectorAll('span');
        if (isExpanded) {
            spans[0].style.transform = 'rotate(45deg) translateY(10px)';
            spans[1].style.opacity = '0';
            spans[2].style.transform = 'rotate(-45deg) translateY(-10px)';
        } else {
            spans[0].style.transform = 'none';
            spans[1].style.opacity = '1';
            spans[2].style.transform = 'none';
        }
    });

    // Fechar menu ao clicar em um link
    navLinks.querySelectorAll('a').forEach(link => {
        link.addEventListener('click', () => {
            navLinks.classList.remove('active');
            menuToggle.setAttribute('aria-expanded', 'false');
            const spans = menuToggle.querySelectorAll('span');
            spans[0].style.transform = 'none';
            spans[1].style.opacity = '1';
            spans[2].style.transform = 'none';
        });
    });

    // Fechar menu ao clicar fora
    document.addEventListener('click', (e) => {
        if (!menuToggle.contains(e.target) && !navLinks.contains(e.target)) {
            navLinks.classList.remove('active');
            menuToggle.setAttribute('aria-expanded', 'false');
            const spans = menuToggle.querySelectorAll('span');
            spans[0].style.transform = 'none';
            spans[1].style.opacity = '1';
            spans[2].style.transform = 'none';
        }
    });
}

// ===== SCROLL REVEAL (ANIMAÇÕES) =====
const observerOptions = {
    root: null,
    threshold: 0.1,
    rootMargin: '0px 0px -50px 0px'
};

const observer = new IntersectionObserver((entries) => {
    entries.forEach(entry => {
        if (entry.isIntersecting) {
            entry.target.style.opacity = '1';
            entry.target.style.transform = 'translateY(0)';
        }
    });
}, observerOptions);

// Observar elementos que devem ter animação de entrada
const animatedElements = document.querySelectorAll('.sobre-card, .especialidade-card, .depoimento-card, .section-header');
animatedElements.forEach(el => {
    el.style.opacity = '0';
    el.style.transform = 'translateY(30px)';
    el.style.transition = 'opacity 0.6s ease, transform 0.6s ease';
    observer.observe(el);
});

// ===== SMOOTH SCROLL =====
document.querySelectorAll('a[href^="#"]').forEach(anchor => {
    anchor.addEventListener('click', function (e) {
        const href = this.getAttribute('href');
        if (href !== '#' && href !== '') {
            e.preventDefault();
            const target = document.querySelector(href);
            if (target) {
                target.scrollIntoView({
                    behavior: 'smooth',
                    block: 'start'
                });
            }
        }
    });
});

// ===== ACTIVE LINK NA NAVEGAÇÃO =====
const currentPage = window.location.pathname.split('/').pop() || 'index.html';
document.querySelectorAll('.nav-links a').forEach(link => {
    const linkPage = link.getAttribute('href');
    if (linkPage === currentPage) {
        link.classList.add('active');
        link.setAttribute('aria-current', 'page');
    } else {
        link.classList.remove('active');
        link.removeAttribute('aria-current');
    }
});

// ===== HEADER SHADOW ON SCROLL =====
const header = document.querySelector('.header');
let lastScroll = 0;

window.addEventListener('scroll', () => {
    const currentScroll = window.pageYOffset;

    if (currentScroll > 50) {
        header.style.boxShadow = '0 4px 12px -8px rgba(61, 50, 41, 0.25)';
    } else {
        header.style.boxShadow = '0 4px 12px -8px rgba(61, 50, 41, 0.15)';
    }

    lastScroll = currentScroll;
});

// ===== FUNÇÕES UTILITÁRIAS =====

// API Helper functions - for use across client and admin pages
// When running from a server (http://localhost:3000) these call the backend API
// When running from file:// or same origin, they fall back to localStorage

const API_BASE = ''; // same origin

async function apiGet(path, withAuth = false) {
    const headers = {};
    const adminPassword = sessionStorage.getItem('admin_password');
    if (withAuth && adminPassword) {
        headers['x-admin-password'] = adminPassword;
    }

    const response = await fetch(API_BASE + path, { headers });
    if (!response.ok) {
        throw new Error('API error: ' + response.status);
    }
    return response.json();
}

async function apiPost(path, data) {
    const response = await fetch(API_BASE + path, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data)
    });
    if (!response.ok) {
        const err = await response.json().catch(() => ({ error: response.statusText }));
        throw new Error(err.error || 'API error');
    }
    return response.json();
}

async function apiPut(path, data) {
    const headers = {};
    const adminPassword = sessionStorage.getItem('admin_password');
    if (adminPassword) {
        headers['x-admin-password'] = adminPassword;
    }

    const response = await fetch(API_BASE + path, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', ...headers },
        body: JSON.stringify(data)
    });
    if (!response.ok) {
        const err = await response.json().catch(() => ({ error: response.statusText }));
        throw new Error(err.error || 'API error');
    }
    return response.json();
}

async function apiDelete(path) {
    const headers = {};
    const adminPassword = sessionStorage.getItem('admin_password');
    if (adminPassword) {
        headers['x-admin-password'] = adminPassword;
    }

    const response = await fetch(API_BASE + path, { method: 'DELETE', headers });
    if (!response.ok) {
        const err = await response.json().catch(() => ({ error: response.statusText }));
        throw new Error(err.error || 'API error');
    }
}

// Legacy: get appointments (with localStorage fallback)
function obterAgendamentosExistentes() {
    const agendamentos = localStorage.getItem('agendamentos');
    return agendamentos ? JSON.parse(agendamentos) : [];
}

// Formatação de data BR
function formatarData(dataStr) {
    const data = new Date(dataStr + 'T00:00:00');
    return data.toLocaleDateString('pt-BR', {
        day: '2-digit',
        month: 'long',
        year: 'numeric'
    });
}

// Formatação de telefone BR
function formatarTelefone(tel) {
    const cleaned = tel.replace(/\D/g, '');
    if (cleaned.length === 11) {
        return `(${cleaned.substr(0,2)}) ${cleaned.substr(2,5)}-${cleaned.substr(7)}`;
    }
    return tel;
}

// Validar email
function validarEmail(email) {
    const regex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    return regex.test(email);
}

// Validar telefone brasileiro
function validarTelefone(tel) {
    const cleaned = tel.replace(/\D/g, '');
    return cleaned.length === 10 || cleaned.length === 11;
}

// ===== TOAST NOTIFICATIONS =====
function mostrarToast(mensagem, tipo = 'success') {
    // Remove toast anterior se existir
    const toastExistente = document.querySelector('.toast');
    if (toastExistente) {
        toastExistente.remove();
    }

    const toast = document.createElement('div');
    toast.className = `toast toast-${tipo}`;
    toast.textContent = mensagem;

    // Estilos inline (evita depender de CSS adicional)
    toast.style.position = 'fixed';
    toast.style.bottom = '20px';
    toast.style.right = '20px';
    toast.style.padding = '1rem 1.5rem';
    toast.style.borderRadius = '8px';
    toast.style.color = 'white';
    toast.style.fontSize = '0.875rem';
    toast.style.fontWeight = '600';
    toast.style.boxShadow = '0 10px 30px -20px rgba(61, 50, 41, 0.35)';
    toast.style.zIndex = '1000';
    toast.style.animation = 'slideIn 0.3s ease';
    toast.style.maxWidth = '300px';

    if (tipo === 'success') {
        toast.style.background = '#7a9b76';
    } else if (tipo === 'error') {
        toast.style.background = '#c97a6f';
    } else if (tipo === 'warning') {
        toast.style.background = '#d4a574';
    }

    document.body.appendChild(toast);

    // Auto-remover após 3 segundos
    setTimeout(() => {
        toast.style.animation = 'slideOut 0.3s ease';
        setTimeout(() => toast.remove(), 300);
    }, 3000);
}

// Animações do toast
const style = document.createElement('style');
style.textContent = `
    @keyframes slideIn {
        from {
            transform: translateX(400px);
            opacity: 0;
        }
        to {
            transform: translateX(0);
            opacity: 1;
        }
    }
    @keyframes slideOut {
        from {
            transform: translateX(0);
            opacity: 1;
        }
        to {
            transform: translateX(400px);
            opacity: 0;
        }
    }
`;
document.head.appendChild(style);

// ===== LOG DE INICIALIZAÇÃO =====
console.log('Site de Veronica Reis Santana da Paz carregado com sucesso!');
