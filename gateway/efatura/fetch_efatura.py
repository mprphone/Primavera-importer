import json
import re
import sys
from datetime import date, datetime

QUERY_URL = (
    "https://faturas.portaldasfinancas.gov.pt/"
    "consultarDocumentosDespesasAtivAdquirente.action"
)


def parse_date(value):
    text = str(value or "").strip()
    for fmt in ("%Y-%m-%d", "%d/%m/%Y", "%d-%m-%Y"):
        try:
            return datetime.strptime(text[:10], fmt).strftime("%Y-%m-%d")
        except ValueError:
            continue
    return ""


def progress(message):
    print(message, file=sys.stderr, flush=True)


def collect(username, password, date_from, date_to):
    from selenium import webdriver
    from selenium.common.exceptions import TimeoutException
    from selenium.webdriver.chrome.options import Options
    from selenium.webdriver.common.by import By
    from selenium.webdriver.support import expected_conditions as EC
    from selenium.webdriver.support.ui import WebDriverWait

    start = date.fromisoformat(date_from)
    end = date.fromisoformat(date_to)
    if start > end:
        raise ValueError("O início do período não pode ser posterior ao fim.")

    options = Options()
    for argument in (
        "--headless=new",
        "--disable-dev-shm-usage",
        "--window-size=1600,1200",
        "--disable-notifications",
        "--no-first-run",
    ):
        options.add_argument(argument)

    progress("A iniciar o Chrome...")
    driver = webdriver.Chrome(options=options)
    try:
        progress("A abrir o Portal das Finanças...")
        driver.get(QUERY_URL)
        wait = WebDriverWait(driver, 40)

        if "acesso.gov.pt" in driver.current_url:
            if not driver.find_elements(By.NAME, "username"):
                nif_buttons = [
                    button for button in driver.find_elements(By.TAG_NAME, "button")
                    if str(button.text or "").strip().upper() == "NIF"
                ]
                if nif_buttons:
                    nif_buttons[-1].click()

            progress("A autenticar na AT...")
            user_input = wait.until(EC.presence_of_element_located((By.NAME, "username")))
            password_input = driver.find_element(By.NAME, "password")
            user_input.send_keys(username)
            password_input.send_keys(password)
            driver.find_element(
                By.CSS_SELECTOR,
                "#login-form button[type='submit'],#login-form input[type='submit']",
            ).click()
            try:
                wait.until(
                    lambda browser: "acesso.gov.pt" not in browser.current_url
                    or browser.find_elements(By.ID, "codigoSms2Fa")
                )
            except TimeoutException as exc:
                page_text = str(driver.find_element(By.TAG_NAME, "body").text or "").lower()
                if "incorret" in page_text or "inválid" in page_text or "invalido" in page_text:
                    raise ValueError("A AT recusou o utilizador ou a palavra-passe.") from exc
                raise ValueError("A autenticação AT excedeu o tempo limite.") from exc

            if driver.find_elements(By.ID, "codigoSms2Fa") or "acesso.gov.pt" in driver.current_url:
                raise ValueError("A AT pediu autenticação adicional/2FA; é necessária intervenção manual.")

        if "consultarDocumentosDespesasAtivAdquirente.action" not in driver.current_url:
            driver.get(QUERY_URL)
        wait.until(EC.presence_of_element_located((By.TAG_NAME, "body")))

        progress(f"A pesquisar documentos de {date_from} a {date_to}...")
        input_count = driver.execute_script(
            """
            const start=arguments[0],end=arguments[1];
            const norm=v=>String(v||'').toLowerCase().normalize('NFD').replace(/[\\u0300-\\u036f]/g,'');
            const inputs=[...document.querySelectorAll('input')].filter(i=>i.type==='date'||/data|inicio|fim/.test(norm(`${i.name} ${i.id} ${i.placeholder}`)));
            const setVal=(i,v)=>{if(!i)return;i.value=v;i.dispatchEvent(new Event('input',{bubbles:true}));i.dispatchEvent(new Event('change',{bubbles:true}));};
            if(inputs.length>=2){setVal(inputs[0],start);setVal(inputs[1],end);}
            const status=document.querySelector('#estadoDocumentoFilter');
            if(status){status.value='';status.dispatchEvent(new Event('change',{bubbles:true}));}
            const scope=document.querySelector('#tipoAmbitoAtividadeFilter');
            if(scope){
              const total=[...scope.options].find(o=>/totalmente/.test(norm(o.text)));
              if(total){scope.value=total.value;scope.dispatchEvent(new Event('change',{bubbles:true}));}
            }
            const submit=document.querySelector('#pesquisar')
              || [...document.querySelectorAll('button,input[type=submit]')].find(n=>/pesquisar|procurar/.test(norm(n.innerText||n.value||n.title)));
            if(submit) submit.click();
            return inputs.length;
            """,
            date_from,
            date_to,
        )
        if input_count < 2:
            raise ValueError("A página da AT mudou: não encontrei os campos do período.")

        try:
            wait.until(
                lambda browser: browser.find_elements(By.ID, "documentos")
                or "sem resultados" in str(browser.find_element(By.TAG_NAME, "body").text or "").lower()
            )
        except TimeoutException as exc:
            raise ValueError("A AT não concluiu a pesquisa no período indicado.") from exc

        driver.execute_script(
            """
            const select=[...document.querySelectorAll('select')].find(s=>/registos por pagina/i.test(s.parentElement?.innerText||''));
            if(select){
              const max=[...select.options].sort((a,b)=>Number(b.value||b.text)-Number(a.value||a.text))[0];
              if(max){select.value=max.value;select.dispatchEvent(new Event('change',{bubbles:true}));}
            }
            """
        )

        invoices = []
        seen = set()
        for page in range(100):
            progress(f"A ler página {page + 1} do e-Fatura...")
            page_rows = driver.execute_script(
                """
                const norm=v=>String(v||'').trim().toLowerCase().normalize('NFD').replace(/[\\u0300-\\u036f]/g,'');
                const candidates=[...document.querySelectorAll('table,[role=grid]')];
                const table=document.querySelector('#documentos')
                  || candidates.find(t=>/(emitente|fornecedor|forncecedor)/.test(norm(t.innerText))&&/data emissao/.test(norm(t.innerText))&&/base tributavel/.test(norm(t.innerText)));
                if(!table)return [];
                const headerRow=table.querySelector('thead tr')||table.querySelector('tr');
                const headers=[...headerRow.querySelectorAll('th,td')].map(c=>norm(c.innerText));
                const idx=(...parts)=>headers.findIndex(h=>parts.some(p=>h.includes(p)));
                const ix={
                  sector:idx('setor','sector'), supplier:idx('emitente','fornecedor','forncecedor'),
                  doc:idx('fatura','atcud','documento'), type:idx('tipo'),
                  date:idx('data emissao','data'), total:idx('valor total','total'),
                  vat:idx('iva'), net:idx('base tributavel','base'),
                  status:idx('situacao','estado')
                };
                const rows=table.querySelectorAll('tbody tr').length?[...table.querySelectorAll('tbody tr')]:[...table.querySelectorAll('tr')].slice(1);
                return rows.map(row=>{
                  const cells=[...row.querySelectorAll('td')].map(cell=>String(cell.innerText||'').trim());
                  const get=index=>index>=0?(cells[index]||''):'';
                  const supplierRaw=get(ix.supplier);
                  const nifMatch=supplierRaw.match(/\\b\\d{9}\\b/);
                  return {
                    document_date:get(ix.date),
                    document_no:get(ix.doc).replace(/\\s+/g,' ').trim(),
                    party_name:supplierRaw.replace(/^\\s*\\d{9}\\s*-?\\s*/,'').trim()||supplierRaw,
                    party_nif:nifMatch?nifMatch[0]:'',
                    description:get(ix.type)||get(ix.sector)||'Importado do e-Fatura',
                    net_amount:get(ix.net), vat_amount:get(ix.vat), total_amount:get(ix.total),
                    status:get(ix.status)
                  };
                }).filter(item=>item.document_date&&item.document_no);
                """
            )

            for item in page_rows or []:
                item["document_date"] = parse_date(item.get("document_date"))
                if not item["document_date"]:
                    continue
                # A AT devolve também documentos anulados quando o filtro de estado fica em
                # branco (pesquisa "todos"). Um documento anulado nunca é lançado na
                # contabilidade, por isso teria sempre de ficar "não confirmada" sem motivo
                # aparente se entrasse como compra normal.
                if "anulad" in str(item.get("status") or "").lower():
                    continue
                key = "|".join((
                    item["document_date"],
                    str(item.get("document_no") or ""),
                    str(item.get("party_nif") or ""),
                ))
                if key not in seen and date_from <= item["document_date"] <= date_to:
                    seen.add(key)
                    invoices.append(item)

            next_buttons = [
                element for element in driver.find_elements(
                    By.CSS_SELECTOR, "#documentos_wrapper a,#documentos_wrapper button"
                )
                if "próxim" in str(element.text or "").lower()
                or "proxim" in str(element.text or "").lower()
            ]
            next_button = next_buttons[-1] if next_buttons else None
            if (
                next_button is None
                or "disabled" in str(next_button.get_attribute("class") or "").lower()
                or next_button.get_attribute("aria-disabled") == "true"
                or not next_button.is_enabled()
            ):
                break
            first_row = driver.execute_script(
                "return String(document.querySelector('#documentos tbody tr')?.innerText||'');"
            )
            next_button.click()
            try:
                wait.until(
                    lambda browser: browser.execute_script(
                        "return String(document.querySelector('#documentos tbody tr')?.innerText||'');"
                    ) != first_row
                )
            except TimeoutException:
                break

        return invoices
    finally:
        driver.quit()


def main():
    if len(sys.argv) != 3:
        raise ValueError("Uso: fetch_efatura.py DATA_INICIAL DATA_FINAL")
    credentials = json.loads(sys.stdin.read() or "{}")
    username = str(credentials.get("user") or "").strip()
    password = str(credentials.get("password") or "")
    if not username or not password:
        raise ValueError("As credenciais das Finanças não estão configuradas.")
    invoices = collect(username, password, sys.argv[1], sys.argv[2])
    print(json.dumps({"invoices": invoices}, ensure_ascii=False), flush=True)


if __name__ == "__main__":
    try:
        main()
    except Exception as exc:
        print(str(exc) or "Erro durante a recolha e-Fatura.", file=sys.stderr, flush=True)
        sys.exit(1)
