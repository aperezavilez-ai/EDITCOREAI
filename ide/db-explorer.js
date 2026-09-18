const dbListEl = document.getElementById("dbList");
const connectionListEl = document.getElementById("connectionList");
const databaseSelectEl = document.getElementById("databaseSelect");
const refreshBtn = document.getElementById("refreshBtn");
const schemaBtn = document.getElementById("schemaBtn");
const sqlInput = document.getElementById("sqlInput");
const runQueryBtn = document.getElementById("runQueryBtn");
const queryStatus = document.getElementById("queryStatus");
const resultArea = document.getElementById("resultArea");
const statusGrid = document.getElementById("statusGrid");

let currentDatabase = null;

function setStatus(text, type = "normal") {
  queryStatus.textContent = text;
  queryStatus.style.borderColor = type === "error" ? "#f85149" : type === "success" ? "#3fb950" : "#30363d";
}

function renderStatus(status) {
  statusGrid.innerHTML = `
    <div class="status-item">
      <div class="label">Bases locales</div>
              <div class="value">${status.localDatabases.length}</div>
            </div>
            <div class="status-item">
              <div class="label">Conexiones</div>
              <div class="value">${status.connections.length}</div>
            </div>
            <div class="status-item">
              <div class="label">SQLite</div>
              <div class="value">${status.sqliteAvailable ? "Disponible" : "No disponible"}</div>
            </div>
            <div class="status-item">
              <div class="label">PostgreSQL</div>
              <div class="value">${status.pgAvailable ? "Disponible" : "No disponible"}</div>
            </div>
          `;
        }

        function renderDatabases(databases) {
          dbListEl.innerHTML = "";

          if (!databases.length) {
            dbListEl.innerHTML = `<div class="empty">Sin bases de datos locales.</div>`;
            return;
          }

          for (const db of databases) {
            const item = document.createElement("div");
            item.className = `db-item${currentDatabase === db.name ? " active" : ""}`;
            item.innerHTML = `
              <span>${db.name}</span>
              <span class="badge">${(db.size / 1024).toFixed(1)} KB</span>
            `;
            item.addEventListener("click", () => {
              currentDatabase = db.name;
              databaseSelectEl.value = db.name;
              sqlInput.value = "SELECT * FROM sqlite_master LIMIT 20;";
              renderDatabases(databases);
              runQuery();
            });
            dbListEl.appendChild(item);
          }
        }

        function renderConnections(connections) {
          connectionListEl.innerHTML = "";

          if (!connections.length) {
            connectionListEl.innerHTML = `<div class="empty">Sin conexiones registradas.</div>`;
            return;
          }

          for (const connection of connections) {
            const item = document.createElement("div");
            item.className = "db-item";
            item.innerHTML = `
              <span>${connection.name}</span>
              <span class="badge">${connection.type}</span>
            `;
            connectionListEl.appendChild(item);
          }
        }

        function renderResult(rows) {
          if (!rows || !rows.length) {
            resultArea.innerHTML = `<div class="empty">Sin resultados.</div>`;
            return;
          }

          const columns = Object.keys(rows[0]);
          let html = `<table class="result-table"><thead><tr>`;
          for (const column of columns) {
            html += `<th>${column}</th>`;
          }
          html += `</tr></thead><tbody>`;

          for (const row of rows) {
            html += `<tr>`;
            for (const column of columns) {
              const value = row[column] === null ? "<span style='color:#8b949e'>NULL</span>" : row[column];
              html += `<td>${value}</td>`;
            }
            html += `</tr>`;
          }

          html += `</tbody></table>`;
          resultArea.innerHTML = html;
        }

        async function loadStatus() {
          const status = await window.editcoreDb.getStatus();
          renderStatus(status);
          renderDatabases(status.localDatabases);
          renderConnections(status.connections);

          databaseSelectEl.innerHTML = `<option value="">Seleccionar base de datos...</option>`;
          for (const db of status.localDatabases) {
            const option = document.createElement("option");
            option.value = db.name;
            option.textContent = db.name;
            databaseSelectEl.appendChild(option);
          }
        }

        async function runQuery() {
          const database = databaseSelectEl.value || currentDatabase;
          const sql = sqlInput.value.trim();

          if (!database) {
            setStatus("Seleccioná una base de datos", "error");
            return;
          }

          if (!sql) {
            setStatus("Ingresá una consulta SQL", "error");
            return;
          }

          setStatus("Ejecutando...");
          resultArea.innerHTML = `<div class="empty">Ejecutando consulta...</div>`;

          try {
            const result = await window.editcoreDb.query(database, sql);
            renderResult(result.rows);
            setStatus(`OK - ${result.rows.length} filas`, "success");
          } catch (error) {
            resultArea.innerHTML = `<div class="empty" style="color:#f85149">${error.message}</div>`;
            setStatus("Error", "error");
          }
        }

        async function showSchema() {
          const database = databaseSelectEl.value || currentDatabase;

          if (!database) {
            setStatus("Seleccioná una base de datos", "error");
            return;
          }

          setStatus("Cargando esquema...");
          resultArea.innerHTML = `<div class="empty">Cargando esquema...</div>`;

          try {
            const schema = await window.editcoreDb.getSchema(database);
            const rows = [
              ...schema.tables.map((table) => ({ type: "table", name: table.name, sql: table.sql })),
              ...schema.indexes.map((index) => ({ type: "index", name: index.name, sql: index.sql })),
              ...schema.views.map((view) => ({ type: "view", name: view.name, sql: view.sql })),
            ];

            renderResult(rows);
            setStatus(`Esquema cargado - ${rows.length} objetos`, "success");
          } catch (error) {
            resultArea.innerHTML = `<div class="empty" style="color:#f85149">${error.message}</div>`;
            setStatus("Error", "error");
          }
        }

        refreshBtn.addEventListener("click", loadStatus);
        runQueryBtn.addEventListener("click", runQuery);
        schemaBtn.addEventListener("click", showSchema);
        databaseSelectEl.addEventListener("change", (event) => {
          currentDatabase = event.target.value;
        });

        loadStatus();
