import { ErroNegocio, type EstadoFisico, type StatusRastreamento } from './domain.js';

export abstract class Validador {
  abstract validar(objeto: unknown): boolean;

  obterMensagemErro(): string {
    return 'Dados inválidos.';
  }
}

export class ValidadorDataEntrada extends Validador {
  override validar(valor: unknown): boolean {
    const timestamp = Date.parse(String(valor));
    const noventaDiasAtras = Date.now() - 90 * 86_400_000;

    return (
      Number.isFinite(timestamp) &&
      timestamp <= Date.now() &&
      timestamp >= noventaDiasAtras
    );
  }

  override obterMensagemErro(): string {
    return 'Data de entrada deve estar entre hoje e os últimos 90 dias.';
  }
}

export class ValidadorCNPJ extends Validador {
  override validar(valor: unknown): boolean {
    const cnpj = String(valor ?? '').replace(/\D/g, '');

    if (cnpj.length !== 14 || /^([0-9])\1+$/.test(cnpj)) {
      return false;
    }

    const calcularDigito = (base: string, pesos: number[]): number => {
      const soma = [...base].reduce(
        (total, digito, indice) => total + Number(digito) * pesos[indice]!,
        0,
      );
      const resto = soma % 11;

      return resto < 2 ? 0 : 11 - resto;
    };

    const primeiroDigito = calcularDigito(cnpj.slice(0, 12), [
      5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2,
    ]);
    const segundoDigito = calcularDigito(`${cnpj.slice(0, 12)}${primeiroDigito}`, [
      6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2,
    ]);

    return cnpj.endsWith(`${primeiroDigito}${segundoDigito}`);
  }

  override obterMensagemErro(): string {
    return 'CNPJ inválido: verifique os 14 dígitos verificadores.';
  }
}

export function exigir(ok: unknown, mensagem: string): asserts ok {
  if (!ok) {
    throw new ErroNegocio(mensagem);
  }
}

export const indiceEstado = (estado: EstadoFisico): number =>
  [
    'NOVO',
    'BOM_ESTADO',
    'USADO_LEVE',
    'USADO_MODERADO',
    'DANIFICADO_LEVE',
    'DANIFICADO_GRAVE',
    'INSERVIVEL',
  ].indexOf(estado);

export const exigirJustificativaDegradacao = (
  estadoAnterior: EstadoFisico,
  estadoNovo: EstadoFisico,
  justificativa: string,
): void => {
  const diferenca = indiceEstado(estadoNovo) - indiceEstado(estadoAnterior);

  if (diferenca >= 2 && !justificativa.trim()) {
    throw new ErroNegocio(
      'Informe justificativa textual para queda de duas ou mais categorias no estado físico.',
    );
  }
};

export const podeIrParaDesmonte = (
  triagemConcluida: boolean,
  status: StatusRastreamento,
): boolean =>
  triagemConcluida &&
  (status === 'AGUARDANDO_DESMONTE' || status === 'EM_DESMONTE');
