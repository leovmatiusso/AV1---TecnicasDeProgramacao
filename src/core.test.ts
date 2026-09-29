import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { ErroNegocio } from './domain.js';
import {
  criarCredencial,
  ServicoAutenticacao,
  verificarSenha,
} from './security.js';
import {
  exigirJustificativaDegradacao,
  ValidadorCNPJ,
  ValidadorDataEntrada,
} from './validators.js';

test('ValidadorCNPJ verifica formato e dígitos', () => {
  const validador = new ValidadorCNPJ();

  assert.equal(validador.validar('11.444.777/0001-61'), true);
  assert.equal(validador.validar('11.444.777/0001-60'), false);
});

test('ValidadorDataEntrada aceita últimos 90 dias e rejeita futuro', () => {
  const validador = new ValidadorDataEntrada();

  assert.equal(validador.validar(new Date().toISOString()), true);
  assert.equal(
    validador.validar(new Date(Date.now() + 86_400_000).toISOString()),
    false,
  );
  assert.equal(
    validador.validar(new Date(Date.now() - 91 * 86_400_000).toISOString()),
    false,
  );
});

test('Degradação de duas categorias exige justificativa', () => {
  assert.throws(
    () => exigirJustificativaDegradacao('BOM_ESTADO', 'USADO_MODERADO', ''),
    ErroNegocio,
  );
  assert.doesNotThrow(() =>
    exigirJustificativaDegradacao(
      'BOM_ESTADO',
      'USADO_MODERADO',
      'Queda registrada na inspeção',
    ),
  );
});

test('Credencial deriva hash salgado e valida senha', () => {
  const credencial = criarCredencial(
    'alguem',
    'SenhaSegura#2026',
    'AUDITOR',
  );

  assert.equal(
    verificarSenha('SenhaSegura#2026', credencial.salt, credencial.hashSenha),
    true,
  );
  assert.equal(
    verificarSenha('senha-errada', credencial.salt, credencial.hashSenha),
    false,
  );
});

test('Sessão renova atividade e pode ser encerrada', () => {
  const autenticacao = new ServicoAutenticacao();
  const token = autenticacao.criarSessao('auditor', 'AUDITOR');

  assert.equal(autenticacao.validar(token).papel, 'AUDITOR');

  autenticacao.encerrar(token);

  assert.throws(() => autenticacao.validar(token), ErroNegocio);
});
