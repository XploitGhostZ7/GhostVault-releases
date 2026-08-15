<div align="center">

# GhostVault

**Gestor de contraseñas de escritorio · Cifrado local AES-256-GCM**

Tus contraseñas nunca salen de tu equipo. Sin nube, sin cuenta, sin telemetría.

<br>

[![Descargar](https://img.shields.io/badge/⬇_Descargar_última_versión-2EA043?style=for-the-badge)](https://github.com/XploitGhostZ7/GhostVault-releases/releases/latest)

<sub>Windows 10/11 · 64 bits</sub>

</div>

<br>

---

## Qué archivo descargar

| Archivo | Cuándo usarlo |
|---|---|
| **`GhostVault-1.0.0-instalador.exe`** | **La opción normal.** Instala en tu perfil de usuario, sin pedir permisos de administrador, y crea accesos directos |
| `GhostVault-1.0.0-portable.exe` | Si no puedes instalar nada en el equipo. Se ejecuta directo, también desde un USB |
| `SHA256SUMS.txt` | Para verificar que el archivo no fue alterado (ver abajo) |

<br>

## Instalación

1. Descarga **`GhostVault-1.0.0-instalador.exe`**.
2. Windows mostrará un aviso azul de SmartScreen. Pulsa **Más información** → **Ejecutar de todas formas**.
3. Elige carpeta si quieres y termina.

Se instala solo para tu usuario, en `%LOCALAPPDATA%\Programs\GhostVault`. No requiere administrador — a propósito, para que funcione en equipos corporativos.

<br>

## Por qué Windows desconfía

El ejecutable **no está firmado digitalmente**. Un certificado de firma de código cuesta entre USD 200 y 400 al año, y sin él SmartScreen avisa de "editor desconocido" hasta que el archivo acumula reputación.

No es que el programa sea sospechoso: es que Microsoft no sabe quién lo hizo. Mientras no haya certificado, la forma correcta de confiar es **verificar el hash**.

### Verificar el hash SHA-256

En PowerShell, en la carpeta donde esté el archivo:

```powershell
Get-FileHash .\GhostVault-1.0.0-instalador.exe -Algorithm SHA256
```

Compara el resultado con el publicado en `SHA256SUMS.txt` de la release. **Si no coincide, no lo instales**: el archivo se corrompió o alguien lo alteró.

<br>

## Primeros pasos

1. **Crea la contraseña maestra.** Mínimo 12 caracteres. El botón *Sugerir una frase de paso segura* genera una buena.
2. **Genera la frase de restablecimiento** en *Ajustes → Frase de restablecimiento*. Son 10 palabras, se muestran **una sola vez**, y son lo único que devuelve el acceso si olvidas la contraseña maestra. Anótalas en papel y guárdalas en otro sitio.
3. **Haz copias del vault.** *Ajustes → Exportar copia cifrada*.

> **No hay recuperación por correo.** Nadie puede restablecer tu contraseña maestra: ese es justamente el punto del cifrado local. Si pierdes la contraseña y la frase de restablecimiento, el vault es irrecuperable.

<br>

## Dónde se guardan tus datos

| Ruta | Contenido |
|---|---|
| `%APPDATA%\GhostVault\vault.xgv` | El vault cifrado. El único archivo con secretos |
| `%LOCALAPPDATA%\Programs\GhostVault` | El programa instalado |

La versión portable también guarda el vault en `%APPDATA%\GhostVault`, **no** en el USB. Si quieres llevarte las contraseñas, usa *Exportar copia cifrada*.

<br>

---

<div align="center">

Este repositorio contiene **solo los binarios de distribución**.<br>
El código fuente es privado. © 2026 XploitGhost / Kompilador. Todos los derechos reservados.

<br>

[![XploitGhost](https://img.shields.io/badge/XploitGhost-111111?style=for-the-badge&logo=github&logoColor=00FF7F)](https://github.com/XploitGhostZ7)

</div>
