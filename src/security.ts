import {
  createCipheriv,
  createDecipheriv,
  createHash,
  pbkdf2Sync,
  randomBytes,
  randomUUID,
  timingSafeEqual,
} from 'node:crypto';
import { chmod, mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { ErroNegocio, type PapelUsuario } from './domain.js';

export interface ConfigMestre {
  versao: 1;
  chaveCriptografia: string;
  parametros?: {
    aliquotaImposto: number;
    coeficienteDepreciacao: number;
  };
  adminInicial?: {
    usuario: string;
    hashSenha: string;
    salt: string;
    papel: PapelUsuario;
    ativo: true;
  };
}

export const hashSenha = (senha: string, salt: string): string =>
  pbkdf2Sync(senha, salt, 310_000, 32, 'sha256').toString('hex');

export const criarCredencial = (
  usuario: string,
  senha: string,
  papel: PapelUsuario,
) => {
  const salt = randomBytes(16).toString('hex');

  return {
    usuario,
    salt,
    hashSenha: hashSenha(senha, salt),
    papel,
    ativo: true as const,
  };
};

export const verificarSenha = (
  senha: string,
  salt: string,
  hash: string,
): boolean => {
  const atual = Buffer.from(hashSenha(senha, salt), 'hex');
  const esperado = Buffer.from(hash, 'hex');

  return atual.length === esperado.length && timingSafeEqual(atual, esperado);
};

export const validarSenha = (senha: string): void => {
  const atendeRequisitos =
    senha.length >= 12 &&
    /[a-z]/.test(senha) &&
    /[A-Z]/.test(senha) &&
    /[0-9]/.test(senha) &&
    /[^A-Za-z0-9]/.test(senha);

  if (!atendeRequisitos) {
    throw new ErroNegocio(
      'Senha deve ter 12+ caracteres, maiúscula, minúscula, número e símbolo.',
    );
  }
};

export const cifrar = (valor: unknown, chaveHex: string): string => {
  const iv = randomBytes(12);
  const cipher = createCipheriv(
    'aes-256-gcm',
    Buffer.from(chaveHex, 'hex'),
    iv,
  );
  const dados = Buffer.concat([
    cipher.update(JSON.stringify(valor), 'utf8'),
    cipher.final(),
  ]);

  return JSON.stringify({
    v: 1,
    iv: iv.toString('base64'),
    tag: cipher.getAuthTag().toString('base64'),
    dados: dados.toString('base64'),
  });
};

export const decifrar = <T>(raw: string, chaveHex: string): T => {
  try {
    const envelope = JSON.parse(raw) as {
      v: number;
      iv: string;
      tag: string;
      dados: string;
    };
    const decipher = createDecipheriv(
      'aes-256-gcm',
      Buffer.from(chaveHex, 'hex'),
      Buffer.from(envelope.iv, 'base64'),
    );

    decipher.setAuthTag(Buffer.from(envelope.tag, 'base64'));

    const plaintext = Buffer.concat([
      decipher.update(Buffer.from(envelope.dados, 'base64')),
      decipher.final(),
    ]).toString('utf8');

    return JSON.parse(plaintext) as T;
  } catch {
    throw new ErroNegocio('Arquivo cifrado inválido ou chave mestra incorreta.');
  }
};

export class ServicoAutenticacao {
  private sessoes = new Map<
    string,
    { usuario: string; papel: PapelUsuario; ultimoUso: number }
  >();

  constructor(private readonly timeoutMs = 30 * 60 * 1000) {}

  criarSessao(usuario: string, papel: PapelUsuario): string {
    const token = randomBytes(32).toString('hex');

    this.sessoes.set(token, {
      usuario,
      papel,
      ultimoUso: Date.now(),
    });

    return token;
  }

  validar(token: string): { usuario: string; papel: PapelUsuario } {
    const sessao = this.sessoes.get(token);

    if (!sessao || Date.now() - sessao.ultimoUso > this.timeoutMs) {
      this.sessoes.delete(token);
      throw new ErroNegocio('Sessão ausente ou expirada. Faça login novamente.');
    }

    sessao.ultimoUso = Date.now();

    return {
      usuario: sessao.usuario,
      papel: sessao.papel,
    };
  }

  encerrar(token: string): void {
    this.sessoes.delete(token);
  }
}

export const novoConfig = (): ConfigMestre => ({
  versao: 1,
  chaveCriptografia: randomBytes(32).toString('hex'),
  parametros: {
    aliquotaImposto: 0,
    coeficienteDepreciacao: 0,
  },
});

export const garantirDiretorioPrivado = async (dir: string): Promise<void> => {
  await mkdir(dir, { recursive: true, mode: 0o700 });

  if (process.platform !== 'win32') {
    await chmod(dir, 0o700);
  }
};

export const gravarPrivado = async (path: string, data: string): Promise<void> => {
  await writeFile(path, data, {
    encoding: 'utf8',
    mode: 0o600,
  });

  if (process.platform !== 'win32') {
    await chmod(path, 0o600);
  }
};

export const assinatura = (valor: string): string =>
  createHash('sha256').update(valor).digest('hex');

export const carregarConfig = async (
  dir: string,
): Promise<ConfigMestre | null> => {
  try {
    const conteudo = await readFile(join(dir, 'config.json'), 'utf8');
    return JSON.parse(conteudo) as ConfigMestre;
  } catch (erro) {
    if ((erro as NodeJS.ErrnoException).code === 'ENOENT') {
      return null;
    }

    throw erro;
  }
};

export const tokenAuditoria = (): string => randomUUID();
