import json
import re
import sys
from datetime import date, datetime

QUERY_URL = (
    "https://faturas.portaldasfinancas.gov.pt/"
    "consultarDocumentosAdquirente.action"
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
    import os

    from selenium import webdriver
    from selenium.common.exceptions import TimeoutException
    from selenium.webdriver.chrome.options import Options
    from selenium.webdriver.chrome.service import Service
    from selenium.webdriver.common.by import By
    from selenium.webdriver.common.keys import Keys
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
        "--no-sandbox",
    ):
        options.add_argument(argument)
    chrome_binary = os.environ.get("CHROME_BINARY")
    if chrome_binary:
        options.binary_location = chrome_binary

    progress("A iniciar o Chrome...")
    chromedriver_path = os.environ.get("CHROMEDRIVER_PATH")
    service = Service(executable_path=chromedriver_path) if chromedriver_path else None
    driver = webdriver.Chrome(service=service, options=options)
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

        if "consultarDocumentosAdquirente.action" not in driver.current_url:
            driver.get(QUERY_URL)
        wait.until(EC.presence_of_element_located((By.TAG_NAME, "body")))

        progress(f"A pesquisar documentos de {date_from} a {date_to}...")

        def type_date(element_id, value):
            try:
                field = driver.find_element(By.ID, element_id)
            except Exception:
                return False
            field.click()
            field.send_keys(Keys.CONTROL, "a")
            field.send_keys(Keys.DELETE)
            field.send_keys(value)
            field.send_keys(Keys.TAB)
            return True

        filled_start = type_date("dataInicioFilter", date_from)
        filled_end = type_date("dataFimFilter", date_to)
        progress(f"[DIAGNÓSTICO] datas preenchidas via teclado: inicio={filled_start} fim={filled_end}")
        if not (filled_start and filled_end):
            raise ValueError("A página da AT mudou: não encontrei os campos do período.")

        try:
            submit_button = driver.find_element(By.ID, "pesquisar")
        except Exception:
            norm = lambda v: str(v or "").strip().lower()
            submit_button = next(
                (
                    element for element in driver.find_elements(
                        By.CSS_SELECTOR, "button,input[type=submit],a.btn,span.btn"
                    )
                    if "pesquisar" in norm(element.text or element.get_attribute("value"))
                    or "procurar" in norm(element.text or element.get_attribute("value"))
                ),
                None,
            )
        if submit_button is None:
            raise ValueError("A página da AT mudou: não encontrei o botão de pesquisa.")
        submit_button.click()

        def table_matches_period(browser):
            dates = browser.execute_script(
                """
                const norm=v=>String(v||'').trim().toLowerCase().normalize('NFD').replace(/[\\u0300-\\u036f]/g,'');
                const table=document.querySelector('#documentos');
                if(!table)return null;
                const headerRow=table.querySelector('thead tr')||table.querySelector('tr');
                if(!headerRow)return null;
                const headers=[...headerRow.querySelectorAll('th,td')].map(c=>norm(c.innerText));
                const dateIndex=headers.findIndex(h=>h.includes('data emissao')||h==='data');
                if(dateIndex<0)return null;
                const rows=table.querySelectorAll('tbody tr').length?[...table.querySelectorAll('tbody tr')]:[...table.querySelectorAll('tr')].slice(1);
                return rows.map(row=>{
                  const cells=[...row.querySelectorAll('td')];
                  return cells[dateIndex]?String(cells[dateIndex].innerText||'').trim():'';
                }).filter(Boolean);
                """
            )
            if not dates:
                return False
            return all(date_from <= parse_date(value) <= date_to for value in dates)

        def search_is_empty(browser):
            text = str(browser.execute_script(
                "return String(document.querySelector('#documentos_wrapper')?.innerText||'');"
            ) or '').lower()
            body_text = str(browser.find_element(By.TAG_NAME, "body").text or "").lower()
            return "total: 0" in text or "sem resultados" in body_text or "não foram encontrados" in body_text

        try:
            wait.until(lambda browser: table_matches_period(browser) or search_is_empty(browser))
        except TimeoutException as exc:
            diagnostics = driver.execute_script(
                """
                const tables=[...document.querySelectorAll('table')].map(t=>({
                  id:t.id, rows:t.querySelectorAll('tbody tr').length,
                  headers:[...(t.querySelector('thead tr')||t.querySelector('tr')||{}).querySelectorAll?.('th,td')||[]]
                    .map(c=>String(c.innerText||'').trim()).join(' | ')
                }));
                return {
                  url: location.href,
                  tables,
                  bodySnippet: String(document.body.innerText||'').slice(0, 600),
                };
                """
            )
            sample_dates = driver.execute_script(
                """
                const norm=v=>String(v||'').trim().toLowerCase().normalize('NFD').replace(/[\\u0300-\\u036f]/g,'');
                const table=document.querySelector('#documentos');
                if(!table)return {dateIndex:-1, sample:[]};
                const headerRow=table.querySelector('thead tr')||table.querySelector('tr');
                const headers=headerRow?[...headerRow.querySelectorAll('th,td')].map(c=>norm(c.innerText)):[];
                const dateIndex=headers.findIndex(h=>h.includes('data emissao')||h==='data');
                const rows=table.querySelectorAll('tbody tr').length?[...table.querySelectorAll('tbody tr')]:[...table.querySelectorAll('tr')].slice(1);
                const sample=rows.slice(0,4).map(row=>[...row.querySelectorAll('td')].map(c=>String(c.innerText||'').trim()));
                return {dateIndex, headers, sample};
                """
            )
            progress(f"[DIAGNÓSTICO] url={diagnostics.get('url')}")
            progress(f"[DIAGNÓSTICO] tabelas={json.dumps(diagnostics.get('tables'), ensure_ascii=False)}")
            progress(f"[DIAGNÓSTICO] linhas={json.dumps(sample_dates, ensure_ascii=False)}")
            progress(f"[DIAGNÓSTICO] texto={diagnostics.get('bodySnippet', '').replace(chr(10), ' / ')}")
            raise ValueError("A AT não concluiu a pesquisa no período indicado.") from exc

        if search_is_empty(driver) and not table_matches_period(driver):
            return []

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
