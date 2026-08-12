-- Configura um acesso só de leitura ao SQL Server do ERP Evolution, para a
-- extensão local do ERP Evolution Importer.
--
-- Corre este script no SQL Server Management Studio (ou sqlcmd), com uma
-- conta que tenha permissões de administrador, ANTES de usar a extensão.
--
-- Substitui os dois valores abaixo antes de correr:
--   1) NomeBaseDados      -> o nome da base de dados desta empresa no ERP Evolution
--                            (o mesmo que está em "Base de dados da empresa" na app)
--   2) DOMINIO\Utilizador -> a conta Windows que vai correr a extensão neste PC
--                            (ex.: SRVSQL\rebelo - normalmente é a conta com que
--                            fazes login no PC onde vais correr o script de arranque)

USE [NomeBaseDados];
GO

IF NOT EXISTS (SELECT * FROM sys.server_principals WHERE name = N'DOMINIO\Utilizador')
BEGIN
    CREATE LOGIN [DOMINIO\Utilizador] FROM WINDOWS;
END
GO

IF NOT EXISTS (SELECT * FROM sys.database_principals WHERE name = N'DOMINIO\Utilizador')
BEGIN
    CREATE USER [DOMINIO\Utilizador] FOR LOGIN [DOMINIO\Utilizador];
END
GO

-- Dá acesso de leitura a todas as tabelas...
ALTER ROLE db_datareader ADD MEMBER [DOMINIO\Utilizador];
GO

-- ...e bloqueia explicitamente qualquer escrita, por segurança extra
-- (a extensão já só faz SELECT, isto é só uma garantia adicional).
DENY INSERT, UPDATE, DELETE, EXECUTE, ALTER TO [DOMINIO\Utilizador];
GO

PRINT 'Acesso de leitura configurado para DOMINIO\Utilizador em NomeBaseDados.';
