// Bot WhatsApp - Sistema Gestor
// Integração com API Claude para extração de Nota Fiscal

const { Client, LocalAuth, MessageMedia } = require('whatsapp-web.js');
const qrcode = require('qrcode-terminal');
const axios = require('axios');
const fs = require('fs');

// CONFIGURAÇÕES - AJUSTAR AQUI
const CONFIG = {
    // URL do seu sistema PHP
    apiUrl: 'https://gestor.thuddo.com/api/whatsapp_webhook.php',
    
    // Números autorizados (deixe vazio para aceitar todos)
    numerosAutorizados: [
        // '5511999999999', // Formato: DDI + DDD + Número
    ],
    
    // Mensagens
    mensagens: {
        boasVindas: '👋 Olá! Sou o assistente do Sistema Gestor.\n\n📄 Envie a foto da sua nota fiscal que eu extraio os dados automaticamente!',
        processando: '⏳ Processando sua nota fiscal...\nAguarde 30 segundos.',
        erro: '❌ Ops! Algo deu errado.\nTente novamente ou entre em contato com o suporte.',
        semCredito: '⚠️ Você não tem créditos disponíveis.\n\nEntre em contato para recarregar:\n📱 (XX) XXXXX-XXXX',
        naoAutorizado: '🚫 Número não autorizado.\n\nPara contratar o serviço:\n📱 (XX) XXXXX-XXXX'
    }
};

// Inicializar cliente WhatsApp
const client = new Client({
    authStrategy: new LocalAuth(),
    puppeteer: {
        headless: true,
        args: [
            '--no-sandbox',
            '--disable-setuid-sandbox',
            '--disable-dev-shm-usage',
            '--disable-accelerated-2d-canvas',
            '--no-first-run',
            '--no-zygote',
            '--single-process',
            '--disable-gpu'
        ]
    }
});

// Evento: QR Code para conectar
client.on('qr', (qr) => {
    console.log('📱 Escaneie o QR Code com seu WhatsApp:');
    qrcode.generate(qr, { small: true });
});

// Evento: Cliente pronto
client.on('ready', () => {
    console.log('✅ Bot WhatsApp conectado e pronto!');
    console.log('📞 Número:', client.info.wid.user);
});

// Evento: Mensagem recebida
client.on('message', async (message) => {
    try {
        const numero = message.from.replace('@c.us', '');
        
        // Verificar se número está autorizado (se lista não vazia)
        if (CONFIG.numerosAutorizados.length > 0) {
            if (!CONFIG.numerosAutorizados.includes(numero)) {
                await message.reply(CONFIG.mensagens.naoAutorizado);
                return;
            }
        }
        
        console.log(`📩 Mensagem de ${numero}:`, message.body);
        
        // Comandos de texto
        if (message.body.toLowerCase() === 'oi' || 
            message.body.toLowerCase() === 'ola' || 
            message.body.toLowerCase() === 'olá' ||
            message.body.toLowerCase() === 'start') {
            await message.reply(CONFIG.mensagens.boasVindas);
            return;
        }
        
        if (message.body.toLowerCase() === 'ajuda' || 
            message.body.toLowerCase() === 'help') {
            const ajuda = `📋 *COMANDOS DISPONÍVEIS:*

📄 *Enviar Nota Fiscal:*
Envie a foto da nota fiscal

💰 *Consultar Créditos:*
Digite: creditos

📊 *Ver Últimas Notas:*
Digite: historico

❓ *Ajuda:*
Digite: ajuda

📞 *Suporte:*
(XX) XXXXX-XXXX`;
            await message.reply(ajuda);
            return;
        }
        
        if (message.body.toLowerCase() === 'creditos') {
            // Consultar créditos no sistema
            const response = await axios.post(CONFIG.apiUrl, {
                action: 'consultar_creditos',
                numero: numero
            });
            
            const creditos = response.data.creditos || 0;
            await message.reply(`💰 *Seus Créditos:* ${creditos} nota(s) disponível(is)`);
            return;
        }
        
        if (message.body.toLowerCase() === 'historico') {
            // Buscar histórico
            const response = await axios.post(CONFIG.apiUrl, {
                action: 'historico',
                numero: numero,
                limit: 5
            });
            
            if (response.data.success && response.data.historico.length > 0) {
                let msg = '📊 *Últimas 5 Notas:*\n\n';
                response.data.historico.forEach((nota, i) => {
                    msg += `${i+1}. ${nota.fornecedor}\n`;
                    msg += `   💰 ${nota.valor} - 📅 ${nota.data}\n\n`;
                });
                await message.reply(msg);
            } else {
                await message.reply('📊 Você ainda não processou nenhuma nota.');
            }
            return;
        }
        
        // Processar imagem (Nota Fiscal)
        if (message.hasMedia) {
            await message.reply(CONFIG.mensagens.processando);
            
            try {
                // Baixar mídia
                const media = await message.downloadMedia();
                
                // Verificar se é imagem
                if (!media.mimetype.startsWith('image/')) {
                    await message.reply('⚠️ Por favor, envie apenas imagens (JPG, PNG, etc)');
                    return;
                }
                
                // Enviar para o sistema PHP processar
                const response = await axios.post(CONFIG.apiUrl, {
                    action: 'processar_nota',
                    numero: numero,
                    imagem: media.data,
                    mimetype: media.mimetype
                }, {
                    timeout: 60000 // 60 segundos
                });
                
                if (response.data.success) {
                    const dados = response.data.dados;
                    
                    // Formatar resposta
                    let resposta = '✅ *Nota Fiscal Processada!*\n\n';
                    resposta += `🏪 *Fornecedor:* ${dados.fornecedor.nome}\n`;
                    resposta += `📋 *CNPJ:* ${dados.fornecedor.cnpj}\n`;
                    resposta += `📄 *Nota:* ${dados.nota.numero}\n`;
                    resposta += `📅 *Data:* ${dados.nota.data}\n`;
                    resposta += `💰 *Valor:* R$ ${dados.nota.valor_total}\n\n`;
                    
                    if (dados.itens && dados.itens.length > 0) {
                        resposta += `📦 *Itens (${dados.itens.length}):*\n`;
                        dados.itens.slice(0, 5).forEach((item, i) => {
                            resposta += `${i+1}. ${item.descricao}\n`;
                            resposta += `   Qtd: ${item.quantidade} | R$ ${item.valor_total}\n`;
                        });
                        
                        if (dados.itens.length > 5) {
                            resposta += `\n... e mais ${dados.itens.length - 5} item(s)\n`;
                        }
                    }
                    
                    resposta += '\n✨ Dados salvos no sistema!';
                    
                    if (response.data.creditos_restantes !== undefined) {
                        resposta += `\n💰 Créditos restantes: ${response.data.creditos_restantes}`;
                    }
                    
                    await message.reply(resposta);
                    
                } else if (response.data.error === 'sem_credito') {
                    await message.reply(CONFIG.mensagens.semCredito);
                    
                } else {
                    await message.reply(CONFIG.mensagens.erro);
                    console.error('Erro na API:', response.data.error);
                }
                
            } catch (error) {
                await message.reply(CONFIG.mensagens.erro);
                console.error('Erro ao processar:', error.message);
            }
        }
        
    } catch (error) {
        console.error('Erro geral:', error);
    }
});

// Evento: Desconectado
client.on('disconnected', (reason) => {
    console.log('❌ Bot desconectado:', reason);
});

// Inicializar
console.log('🚀 Iniciando Bot WhatsApp...');
client.initialize();

// Health check endpoint (Railway precisa disso)
const express = require('express');
const app = express();
const PORT = process.env.PORT || 3000;

app.get('/', (req, res) => {
    res.json({ 
        status: 'online',
        bot: client.info ? 'connected' : 'disconnected'
    });
});

app.listen(PORT, () => {
    console.log(`🌐 Health check rodando na porta ${PORT}`);
});
