import {
    Client, GatewayIntentBits, EmbedBuilder, ActionRowBuilder,
    ButtonBuilder, ButtonStyle, type Message, type Interaction, type TextChannel
} from 'discord.js';
import * as dotenv from 'dotenv';
import cron from 'node-cron';
import express, { type Request, type Response } from 'express';
import mongoose from 'mongoose';

dotenv.config();

// --- MONGODB SCHEMA ---
interface IParty extends mongoose.Document {
    partyId: string;
    criador: string;
    horario: string;
    membros: string[];
    canalId: string;
}

const partySchema = new mongoose.Schema({
    partyId: String,
    criador: String,
    horario: String,
    membros: [String],
    canalId: String
});
const PartyModel = mongoose.model<IParty>('Party', partySchema);

// --- EXPRESS KEEP-ALIVE ---
const app = express();
const port = process.env.PORT || 3000;
app.get('/', (_req: Request, res: Response) => res.send('🤖 Bot Online com MongoDB!'));
app.listen(Number(port), '0.0.0.0');

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent, GatewayIntentBits.DirectMessages
    ]
});

const SEU_ID_ADMIN = "1088425447760605275";
const CARGO_ID = "1466552837503975595";

// --- FUNÇÃO AGENDAR ---
function agendarNotificacoes(partyId: string, horario: string, canalId: string) {
    const timeParts = horario.split(':').map(Number);
    const h = timeParts[0];
    const m = timeParts[1];

    if (h === undefined || m === undefined || isNaN(h) || isNaN(m)) return;

    let dmMin = m - 15;
    let dmHora = h;
    if (dmMin < 0) { dmMin += 60; dmHora -= 1; }

    // Aviso 15min antes
    cron.schedule(`${dmMin} ${dmHora} * * *`, async () => {
        const p = await PartyModel.findOne({ partyId });
        if (p && p.membros.length > 0) {
            for (const id of p.membros) {
                try {
                    const u = await client.users.fetch(id);
                    await u.send(`🤫 **SANTUÁRIO:** Faltam 15min para a PT das ${horario}!`);
                } catch (e) { console.error(`Erro DM para ${id}`); }
            }
        }
    }, {
        timezone: "America/Sao_Paulo"
    });

    // Hora do Boss
    cron.schedule(`${m} ${h} * * *`, async () => {
        const p = await PartyModel.findOne({ partyId });
        if (p && p.membros.length > 0) {
            const channelRaw = await client.channels.fetch(canalId);
            if (channelRaw && channelRaw.isTextBased()) {
                const canal = channelRaw as TextChannel;
                const mencoes = p.membros.map((id: string) => `<@${id}>`).join(', ');
                await canal.send(`⚔️ **HORA DO BOSS!** PT das ${horario}: ${mencoes}`);
                await PartyModel.deleteOne({ partyId });
            }
        }
    }, {
        timezone: "America/Sao_Paulo"
    });
}

client.once('ready', async () => {
    console.log(`🤖 Bot online como ${client.user?.tag}`);
    try {
        await mongoose.connect(process.env.MONGO_URI!);
        console.log("🍃 Conectado ao MongoDB Atlas");
    } catch (err) {
        console.error("❌ ERRO NO MONGO:", err);
    }
});

// Limpeza automática todos os dias às 3 da manhã
cron.schedule('0 3 * * *', async () => {
    console.log("🧹 Iniciando limpeza diária de PTs antigas...");
    try {
        const resultado = await PartyModel.deleteMany({});
        console.log(`✅ Limpeza concluída: ${resultado.deletedCount} registros removidos.`);
    } catch (err) {
        console.error("❌ Erro na limpeza automática:", err);
    }
}, {
    timezone: "America/Sao_Paulo"
});

client.on('messageCreate', async (message: Message) => {
    if (message.content === '!LimparBanco' && message.author.id === SEU_ID_ADMIN) {
        try {
            const resultado = await PartyModel.deleteMany({});
            await message.reply(`✅ Faxina concluída! Removidas **${resultado.deletedCount}** PTs do MongoDB.`);
        } catch (e) {
            console.error(e);
            await message.reply('❌ Erro ao limpar o banco.');
        }
        return;
    }


    if (message.author.bot) return;

    if (message.content.startsWith('!PtSantuario')) {
        const horario = message.content.split(' ')[1];
        if (!horario?.includes(':')) return message.reply('❌ Use: `!PtSantuario HH:mm`');

        const partyId = message.id;
        await PartyModel.create({
            partyId,
            criador: message.author.id,
            horario,
            membros: [message.author.id],
            canalId: message.channel.id
        });

        agendarNotificacoes(partyId, horario, message.channel.id);

        const embed = new EmbedBuilder()
            .setTitle('⚔️ BOSS SANTUÁRIO')
            .setDescription(`**Horário:** ${horario}\n**Membros:** (1/5)\n1. <@${message.author.id}>`)
            .setColor(0x0099FF);

        const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
            new ButtonBuilder().setCustomId(`join_${partyId}`).setLabel('JOIN PT').setStyle(ButtonStyle.Success),
            new ButtonBuilder().setCustomId(`leave_${partyId}`).setLabel('SAIR/CANCELAR').setStyle(ButtonStyle.Danger)
        );

        if (message.channel.isTextBased()) {
            const canal = message.channel as TextChannel;
            await canal.send({ content: `📢 <@&${CARGO_ID}> Nova PT!`, embeds: [embed], components: [row] });
        }
    }
});


client.on('messageReactionAdd', async (reaction, user) => {
    if (user.bot) return;
    if (reaction.partial) await reaction.fetch();

    const ID_DA_MENSAGEM = "1466981759957860619";
    const EMOTE_ALVO = "⛩️";
    const ID_DO_CARGO = "1466552837503975595";

    if (reaction.message.id === ID_DA_MENSAGEM && reaction.emoji.name === EMOTE_ALVO) {
        const guild = reaction.message.guild;
        const member = await guild?.members.fetch(user.id);
        await member?.roles.add(ID_DO_CARGO);
        console.log(`✅ ${user.username} ganhou o cargo!`);
    }
});

client.on('messageReactionRemove', async (reaction, user) => {
    if (user.bot) return;
    if (reaction.partial) await reaction.fetch();

    const ID_DA_MENSAGEM = "1466981759957860619";
    const EMOTE_ALVO = "⛩️";
    const ID_DO_CARGO = "1466552837503975595";

    if (reaction.message.id === ID_DA_MENSAGEM && reaction.emoji.name === EMOTE_ALVO) {
        const guild = reaction.message.guild;
        const member = await guild?.members.fetch(user.id);
        await member?.roles.remove(ID_DO_CARGO);
        console.log(`❌ ${user.username} perdeu o cargo!`);
    }
});

client.on('interactionCreate', async (interaction: Interaction) => {
    if (!interaction.isButton()) return;
    const [acao, id] = interaction.customId.split('_');

    if (!id) return; // Segurança extra
    const p = await PartyModel.findOne({ partyId: id as string });
    if (!p) return interaction.reply({ content: 'PT não encontrada ou já iniciada.', ephemeral: true });

    // --- LÓGICA DE SAIR OU CANCELAR ---
    if (acao === 'leave') {
        if (interaction.user.id === p.criador) {
            await PartyModel.deleteOne({ partyId: id });
            return interaction.update({ content: '❌ PT Cancelada pelo criador.', embeds: [], components: [] });
        }

        if (!p.membros.includes(interaction.user.id)) {
            return interaction.reply({ content: 'Você não está nesta PT!', ephemeral: true });
        }

        p.membros = p.membros.filter(mId => mId !== interaction.user.id);
        await p.save();
    }
    // --- LÓGICA DE ENTRAR ---
    else if (acao === 'join') {
        if (p.membros.includes(interaction.user.id)) {
            return interaction.reply({ content: 'Já está na PT!', ephemeral: true });
        }
        if (p.membros.length >= 5) {
            return interaction.reply({ content: 'A PT já está lotada!', ephemeral: true });
        }

        p.membros.push(interaction.user.id);
        await p.save();
    }

    // --- ATUALIZAÇÃO DO EMBED (Comum para Join e Leave) ---
    const lista = p.membros.map((mid, i) => `${i + 1}. <@${mid}>`).join('\n');
    const embedOriginal = interaction.message.embeds[0];
    if (!embedOriginal) return;

    const newEmbed = EmbedBuilder.from(embedOriginal)
        .setDescription(`**Horário:** ${p.horario}\n**Membros:** (${p.membros.length}/5)\n${lista}`);

    await interaction.update({ embeds: [newEmbed] });
});

client.login(process.env.DISCORD_TOKEN!);