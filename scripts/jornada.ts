import { strict as assert } from 'node:assert';
import { randomBytes } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { criarCredencial } from '../src/security.js';
import { ServicoDominio } from '../src/services.js';
import { RepositorioArquivo } from '../src/storage.js';

const diretorio = await mkdtemp(join(tmpdir(), 'greencode-jornada-'));

try {
  console.log('\n=== Jornada automatizada do GreenCode ===');
  console.log('[1/9] Preparando armazenamento temporário cifrado...');

  const chave = randomBytes(32).toString('hex');
  const repositorio = new RepositorioArquivo(diretorio, chave);
  await repositorio.inicializar();

  const servico = new ServicoDominio(repositorio);
  const administrador = criarCredencial(
    'admin.teste',
    'JornadaSegura#2026',
    'ADMINISTRADOR',
  );

  console.log('[2/9] Provisionando administrador e verificando login...');

  await repositorio.transacionar(
    'PROVISIONAMENTO',
    'Credencial',
    null,
    administrador,
    'sistema',
    (estado) => {
      estado.credenciais.push(administrador);
    },
  );

  const credencial = await servico.login(
    'admin.teste',
    'JornadaSegura#2026',
  );
  assert.equal(credencial.papel, 'ADMINISTRADOR');

  console.log('      Login confirmado com papel ADMINISTRADOR.');
  console.log('[3/9] Cadastrando organização de teste...');

  const organizacao = await servico.cadastrarOrganizacao(
    {
      razaoSocial: 'Organização Jornada de Teste',
      cnpj: '11444777000161',
      inscricaoEstadual: 'ISENTO',
      enderecoCompleto: 'Rua de Teste, 100',
      telefone: '11999990000',
      email: 'teste@example.com',
    },
    'admin.teste',
  );

  console.log(
    `      Organização: ${organizacao.razaoSocial} (ID ${organizacao.id}).`,
  );
  console.log('[4/9] Criando lote ligado à organização...');

  const lote = await servico.criarLote(
    organizacao.id,
    'NF-0001',
    'Transportadora de Teste',
    new Date().toISOString(),
    'admin.teste',
  );

  console.log(`      Lote ${lote.id}, nota fiscal ${lote.notaFiscal}.`);
  console.log('[5/9] Cadastrando equipamento no lote...');

  const equipamento = await servico.criarEquipamento(
    {
      loteId: lote.id,
      tipo: 'NOTEBOOK',
      marca: 'Exemplo',
      modelo: 'Modelo A',
      anoFabricacao: 2022,
      estadoFisico: 'BOM_ESTADO',
      pesoQuilogramas: 2.1,
    },
    'admin.teste',
  );

  console.log(
    `      Equipamento ${equipamento.codigoBarrasInterno} (${equipamento.id}).`,
  );
  console.log('[6/9] Confirmando que desmonte antes da triagem é bloqueado...');

  await assert.rejects(
    () =>
      servico.movimentar(
        equipamento.id,
        'EM_DESMONTE',
        'Técnico',
        '',
        'admin.teste',
      ),
    /triagem completa/,
  );

  console.log('      Regra aplicada: desmonte bloqueado antes da triagem.');
  console.log('[7/9] Iniciando e concluindo a triagem do lote...');

  await servico.iniciarTriagem(lote.id, 'admin.teste');
  await servico.registrarTriagem(lote.id, 'admin.teste');

  console.log('      Triagem concluída. Registrando três movimentações...');

  await servico.movimentar(
    equipamento.id,
    'EM_TRIAGEM',
    'Técnico',
    'Inspeção inicial',
    'admin.teste',
  );
  await servico.movimentar(
    equipamento.id,
    'AGUARDANDO_DESMONTE',
    'Técnico',
    'Triagem concluída',
    'admin.teste',
  );
  await servico.movimentar(
    equipamento.id,
    'EM_DESMONTE',
    'Técnico',
    'Encaminhado à bancada',
    'admin.teste',
  );

  console.log(
    '      AGUARDANDO_TRIAGEM → EM_TRIAGEM → AGUARDANDO_DESMONTE → EM_DESMONTE.',
  );
  console.log('[8/9] Reiniciando o repositório e verificando recuperação pelo journal...');

  const repositorioReiniciado = new RepositorioArquivo(diretorio, chave);
  await repositorioReiniciado.inicializar();

  const equipamentoRecuperado = repositorioReiniciado
    .obterEstado()
    .equipamentos.find((item) => item.id === equipamento.id);

  assert.equal(equipamentoRecuperado?.statusRastreamento, 'EM_DESMONTE');
  assert.equal(equipamentoRecuperado?.historicoMovimentacao.length, 3);

  console.log(
    `      Estado recuperado: ${equipamentoRecuperado!.statusRastreamento}; ` +
      `movimentações: ${equipamentoRecuperado!.historicoMovimentacao.length}.`,
  );
  console.log('[9/9] Jornada concluída com sucesso.');
  console.log(
    `      Rastreio final: ${equipamentoRecuperado!.codigoBarrasInterno} — ` +
      `${equipamentoRecuperado!.statusRastreamento}.\n`,
  );
} finally {
  await rm(diretorio, { recursive: true, force: true });
}
