using System;
using System.IO;
using System.Reflection;
using System.Runtime.CompilerServices;

namespace PrimaveraConnectionTest
{
    internal static class Program
    {
        private static string _primaveraDirectory = "";

        private static int Main(string[] args)
        {
            Console.OutputEncoding = System.Text.Encoding.UTF8;
            Console.WriteLine("Teste de ligação ao ERP Evolution v10");
            Console.WriteLine("------------------------------------");

            if (args.Length < 5)
            {
                Console.Error.WriteLine(
                    "Uso interno: PrimaveraConnectionTest.exe <pasta-ERP Evolution> <empresa> <utilizador> <instância> <plataforma>");
                return 2;
            }

            _primaveraDirectory = args[0];
            AppDomain.CurrentDomain.AssemblyResolve += ResolvePrimaveraAssembly;

            var company = args[1];
            var user = args[2];
            var instance = args[3];
            var platform = args[4];
            var password = ReadPassword("Palavra-passe do utilizador ERP Evolution: ");

            try
            {
                return OpenCompany(company, user, password, instance, platform);
            }
            catch (Exception exception)
            {
                var root = Unwrap(exception);
                Console.ForegroundColor = ConsoleColor.Red;
                Console.WriteLine();
                Console.WriteLine("FALHOU: não foi possível abrir a empresa.");
                Console.ResetColor();
                Console.WriteLine("Tipo: " + root.GetType().FullName);
                Console.WriteLine("Mensagem: " + root.Message);
                Console.WriteLine();
                Console.WriteLine("Verifique o código da empresa, utilizador, palavra-passe, instância, permissões e licença da API.");
                return 1;
            }
        }

        [MethodImpl(MethodImplOptions.NoInlining)]
        private static int OpenCompany(string company, string user, string password, string instance, string platform)
        {
            Console.WriteLine();
            Console.WriteLine("Empresa: " + company);
            Console.WriteLine("Utilizador: " + user);
            Console.WriteLine("Instância: " + instance);
            Console.WriteLine("A abrir a empresa...");

            var erpAssembly = Assembly.LoadFrom(Path.Combine(_primaveraDirectory, "ErpBS100.dll"));
            var stdBeAssembly = Assembly.LoadFrom(Path.Combine(_primaveraDirectory, "StdBE100.dll"));
            var engineType = erpAssembly.GetType("ErpBS100.ErpBS", true);
            var transactionType = stdBeAssembly.GetType("StdBE100.StdBETransaccao", true);
            var engine = Activator.CreateInstance(engineType);
            var transaction = Activator.CreateInstance(transactionType);
            var openMethod = FindOpenCompanyMethod(engineType);
            var businessPlatform = FindPlatformValue(stdBeAssembly, platform);
            var arguments = BuildOpenCompanyArguments(
                openMethod,
                company,
                user,
                password,
                instance,
                transactionType,
                transaction,
                businessPlatform);

            Console.WriteLine("Assinatura encontrada: " + FormatMethod(openMethod));
            Console.WriteLine("Plataforma selecionada: " + platform + " (" + businessPlatform + ")");
            openMethod.Invoke(engine, arguments);

            Console.ForegroundColor = ConsoleColor.Green;
            Console.WriteLine();
            Console.WriteLine("SUCESSO: a empresa foi aberta através do motor de integração.");
            Console.ResetColor();
            Console.WriteLine("As DLL, credenciais, permissões e acesso à base de dados estão funcionais.");
            return 0;
        }

        private static MethodInfo FindOpenCompanyMethod(Type engineType)
        {
            MethodInfo best = null;
            foreach (var method in engineType.GetMethods(BindingFlags.Instance | BindingFlags.Public))
            {
                if (method.Name != "AbreEmpresaTrabalho") continue;
                var parameters = method.GetParameters();
                if (parameters.Length >= 4 &&
                    parameters.Length <= 8 &&
                    parameters[1].ParameterType == typeof(string) &&
                    parameters[2].ParameterType == typeof(string) &&
                    parameters[3].ParameterType == typeof(string))
                {
                    // Preferimos a sobrecarga mais curta. As restantes opções
                    // são preenchidas de acordo com o tipo real da instalação.
                    if (best == null || parameters.Length < best.GetParameters().Length)
                    {
                        best = method;
                    }
                }
            }

            if (best != null) return best;

            throw new MissingMethodException(
                engineType.FullName,
                "Não foi encontrada uma sobrecarga compatível de AbreEmpresaTrabalho.");
        }

        private static object[] BuildOpenCompanyArguments(
            MethodInfo method,
            string company,
            string user,
            string password,
            string instance,
            Type transactionType,
            object transaction,
            int businessPlatform)
        {
            var parameters = method.GetParameters();
            var arguments = new object[parameters.Length];
            arguments[0] = parameters[0].ParameterType == typeof(int)
                ? (object)businessPlatform
                : Enum.ToObject(parameters[0].ParameterType, businessPlatform);
            arguments[1] = company;
            arguments[2] = user;
            arguments[3] = password;

            for (var index = 4; index < parameters.Length; index++)
            {
                var parameter = parameters[index];
                var type = parameter.ParameterType;

                if (type.IsAssignableFrom(transactionType))
                {
                    arguments[index] = transaction;
                }
                else if (type == typeof(string))
                {
                    arguments[index] = instance;
                }
                else if (type == typeof(bool))
                {
                    arguments[index] = true;
                }
                else if (type.IsEnum)
                {
                    arguments[index] = CreateEnumValue(type, "tlDesktop", "Desktop");
                }
                else if (parameter.HasDefaultValue)
                {
                    arguments[index] = parameter.DefaultValue;
                }
                else
                {
                    arguments[index] = null;
                }
            }

            return arguments;
        }

        private static int FindPlatformValue(Assembly stdBeAssembly, string platform)
        {
            string[] preferredNames;
            if (string.Equals(platform, "Evolution", StringComparison.OrdinalIgnoreCase))
            {
                preferredNames = new[] { "tpEvolution", "Evolution" };
            }
            else if (string.Equals(platform, "Professional", StringComparison.OrdinalIgnoreCase))
            {
                preferredNames = new[] { "tpProfissional", "tpProfessional", "Profissional", "Professional" };
            }
            else
            {
                preferredNames = new[] { "tpEmpresarial", "Empresarial", "Executive" };
            }

            foreach (var type in stdBeAssembly.GetTypes())
            {
                if (!type.IsEnum || type.Name != "EnumTipoPlataforma") continue;
                foreach (var name in Enum.GetNames(type))
                {
                    foreach (var preferredName in preferredNames)
                    {
                        if (string.Equals(name, preferredName, StringComparison.OrdinalIgnoreCase) ||
                            name.IndexOf(preferredName, StringComparison.OrdinalIgnoreCase) >= 0)
                        {
                            return Convert.ToInt32(Enum.Parse(type, name));
                        }
                    }
                }

                var available = string.Join(", ", Enum.GetNames(type));
                throw new InvalidOperationException(
                    "A plataforma " + platform + " não existe em EnumTipoPlataforma. Valores disponíveis: " + available);
            }

            throw new TypeLoadException(
                "Não foi possível encontrar EnumTipoPlataforma na StdBE100.dll.");
        }

        private static object CreateEnumValue(Type type, params string[] preferredNames)
        {
            if (!type.IsEnum) throw new InvalidOperationException("Tipo enumerado inesperado: " + type.FullName);

            var names = Enum.GetNames(type);
            foreach (var preferred in preferredNames)
            {
                foreach (var name in names)
                {
                    if (string.Equals(name, preferred, StringComparison.OrdinalIgnoreCase) ||
                        name.IndexOf(preferred, StringComparison.OrdinalIgnoreCase) >= 0)
                    {
                        return Enum.Parse(type, name);
                    }
                }
            }

            return Enum.GetValues(type).GetValue(0);
        }

        private static string FormatMethod(MethodInfo method)
        {
            var parameters = method.GetParameters();
            var parts = new string[parameters.Length];
            for (var index = 0; index < parameters.Length; index++)
            {
                parts[index] = parameters[index].ParameterType.Name + " " + parameters[index].Name;
            }
            return method.Name + "(" + string.Join(", ", parts) + ")";
        }

        private static Assembly ResolvePrimaveraAssembly(object sender, ResolveEventArgs args)
        {
            var assemblyName = new AssemblyName(args.Name).Name + ".dll";
            var candidate = Path.Combine(_primaveraDirectory, assemblyName);
            return File.Exists(candidate) ? Assembly.LoadFrom(candidate) : null;
        }

        private static string ReadPassword(string prompt)
        {
            Console.Write(prompt);
            var password = "";

            while (true)
            {
                var key = Console.ReadKey(true);
                if (key.Key == ConsoleKey.Enter)
                {
                    Console.WriteLine();
                    return password;
                }

                if (key.Key == ConsoleKey.Backspace)
                {
                    if (password.Length > 0) password = password.Substring(0, password.Length - 1);
                    continue;
                }

                if (!char.IsControl(key.KeyChar)) password += key.KeyChar;
            }
        }

        private static Exception Unwrap(Exception exception)
        {
            while (exception is TargetInvocationException && exception.InnerException != null)
            {
                exception = exception.InnerException;
            }
            return exception;
        }
    }
}
