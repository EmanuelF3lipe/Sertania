# Instalação de WSL2 e Docker Desktop

Esta etapa exige **PowerShell como Administrador**. Não consigo executá-la: a conta
`DESKTOP-EMANUEL\emanu` não é|elevationada, e `Get-WindowsOptionalFeature` já
respondeu *"A operação solicitada requer elevação"* quando consultado.

O que verifiquei antes de pedir a instalação:

| Verificação | Resultado |
| --- | --- |
| HypervisorPresent | `False` (nenhuma virtualização ativa) |
| VirtualizationFirmwareEnabled | `True` (suporte de hardware presente) |
| Build do Windows | `10.0.26200` (atende ao requisito de WSL2) |
| WSL instalado | Não |
| Docker Desktop instalado | Não |
| Espaço em disco | a confirmar |

O suporte de virtualização por firmware está habilitado, então o caminho é viável.

## Passo 1 — Ativar os recursos do Windows

Abra **PowerShell como Administrador** e execute, um por vez, confirmando cada um:

```powershell
wsl --install --no-distribution
```

Esse comando já habilita `Microsoft-Windows-Subsystem-Linux` e
`VirtualMachinePlatform`. Se preferir controlar separadamente:

```powershell
dism.exe /online /enable-feature /featurename:Microsoft-Windows-Subsystem-Linux /all /norestart
dism.exe /online /enable-feature /featurename:VirtualMachinePlatform /all /norestart
```

## Passo 2 — Reiniciar

O Windows precisa reiniciar para carregar o hypervisor. Salve seus arquivos antes.

## Passo 3 — Confirmar após o reinício

```powershell
wsl --status
Get-WindowsOptionalFeature -Online -FeatureName VirtualMachinePlatform
```

Esperado: `VirtualMachinePlatform` como `Enabled` e o `wsl --status` sem erro.

## Passo 4 — Instalar o Docker Desktop

Baixe o instalador oficial em <https://www.docker.com/products/docker-desktop/>
e execute-o. Durante a instalação, aceite ativar o WSL2. Se aparecer a opção de
"Use WSL 2 instead of Hyper-V", deixe marcada — o Hyper-V não está disponível aqui.

Reinicie se solicitado. Depois abra o Docker Desktop e aguarde o indicador
*Engine running* ficar verde.

## Passo 5 — Validar

```powershell
docker version
docker compose version
```

Ambos devem responder sem erro. Com isso, eu subo a stack completa do projeto
(§18 da especificação): PostgreSQL 17 + PostGIS, Redis de sessão, Redis de fila
separado, Keycloak, emulador S3, ClamAV e caixa de e-mail de teste.

## Alternativa sem Docker Desktop

Se a instalação do Docker for inviável na sua máquina, há um caminho nativo em
Windows que não exige Docker nem WSL2, mas **não atende** à especificação:

- PostgreSQL 17 + PostGIS instalado nativamente pelo instalador oficial
- Redis pelo Windows Subsystem for Unix ou pelo binário para Windows
- Keycloak como processo Java, com o seu próprio banco

Nesse caminho, Keycloak e ClamAV viram serviços locais e os scripts de
provisionamento precisam de adaptações. Eu preparo essa variante se for o seu
caso — basta dizer.
