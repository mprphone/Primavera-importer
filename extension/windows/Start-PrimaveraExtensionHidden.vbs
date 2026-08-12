Option Explicit

Dim shell, installRoot, runner, command
Set shell = CreateObject("WScript.Shell")

installRoot = shell.ExpandEnvironmentStrings("%LOCALAPPDATA%") & "\ERP Evolution Importer\Extension"
runner = installRoot & "\windows\Run-PrimaveraExtension.ps1"
command = "powershell.exe -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File """ & runner & """"

shell.Run command, 0, False
