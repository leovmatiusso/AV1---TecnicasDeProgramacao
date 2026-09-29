# GreenCode

CLI em Node.js e TypeScript para a atividade AV1 de logística reversa de equipamentos eletrônicos.

## Requisitos

- Node.js 20 ou superior e npm.
- Windows 10+, Ubuntu 24.04+ ou distribuição derivada.

## Instalação e execução

```sh
npm install
npm run build
npm start
```

Na primeira execução, o programa solicita a criação do usuário administrador. A senha precisa ter ao menos 12 caracteres, com maiúscula, minúscula, número e símbolo. O diretório de dados padrão é `~/.greencode`; use `GREENCODE_HOME` para apontar para outro local. No Windows, proteja esse diretório com ACLs do usuário que executa o sistema.

Digite `ajuda` no prompt para ver comandos e parâmetros. Exemplo:

```text
login
organizacao cadastrar --razao "Empresa Exemplo" --cnpj 11444777000161 --email contato@example.com
lote criar --org ID_DA_ORGANIZACAO --nf 123456 --transp TransRapida
equipamento adicionar --lote ID_DO_LOTE --tipo NOTEBOOK --marca Dell --modelo Latitude --ano 2022 --estado BOM_ESTADO --peso 2.1
triagem iniciar --lote ID_DO_LOTE
triagem concluir --lote ID_DO_LOTE
equipamento rastrear --id GC-2026-000001
```

As credenciais de login são o nome de usuário e a senha definidos no provisionamento. A senha não é exibida ao digitá-la. `Ctrl+C` encerra o programa.

## Cobertura entregue

- Papéis `administrador`, `operador_cadastro`, `gestor_almoxarifado` e `auditor`, com permissões aplicadas por comando.
- Administração de contas, ativação e desativação de organizações, contratos e parâmetros globais de imposto e depreciação.
- Credenciais em `credenciais.enc`, derivadas com PBKDF2-HMAC-SHA-256, salt aleatório e comparação em tempo constante.
- Arquivos de organizações, contratos, lotes e equipamentos separados; todos cifrados com AES-256-GCM e gravados em substituição atômica.
- Journal cifrado, com sincronização ao disco antes da atualização dos arquivos de estado, recuperação por replay e reversão administrativa como nova transação auditável.
- Retenção de 180 dias e rotação de arquivos de journal acima de 10 MiB.
- Sessão com renovação por atividade e expiração após 30 minutos; menu de ajuda com operações e autocomplete via readline.
- Validadores de CNPJ, datas de entrada, status de triagem/desmonte e justificativa de degradação física.
- Scripts de teste unitário e jornada de provisionamento a rastreabilidade após reinício.

## Segurança e limitações conhecidas

O SHA-256 direto é rápido e inadequado para armazenamento de senha. Para manter SHA-256 como algoritmo-base solicitado no enunciado, a implementação usa PBKDF2-HMAC-SHA-256 com 310 mil iterações e salt por usuário. AES-256-GCM oferece confidencialidade e detecção de adulteração. O journal guarda um registro cifrado por linha; não se deve editar ou remover esses registros manualmente.

Os parâmetros globais são consultados com `parametros ver` e definidos por administrador com `parametros definir --imposto 12.5 --depreciacao 0.15`. A alíquota aceita percentual de 0 a 100; o coeficiente de depreciação aceita valor entre 0 e 1.

A chave mestra precisa estar disponível para inicializar o sistema e fica em `config.json`, protegida pelas permissões do diretório. Isso protege os dados em repouso contra leitura sem a chave, mas quem obtiver simultaneamente o arquivo e a chave poderá decifrá-los. Faça backup seguro do arquivo de configuração e dos dados juntos; perder a chave significa perder acesso aos arquivos cifrados. O hash SHA-256 do journal não é encadeado criptograficamente; o GCM detecta alteração em registros individuais, mas não prova a ordem histórica contra um atacante com a chave. Em produção, proteja a chave em um cofre do sistema operacional e ancore os registros em armazenamento externo imutável.

## Testes de jornada

```sh
npm test
npm run jornada
```

A jornada usa um diretório temporário e o remove ao terminar. Ela cobre provisionamento e login por serviço, cadastro de organização, lote e equipamento, bloqueio de desmonte antes da triagem, movimentações e reconstrução após reinício.
