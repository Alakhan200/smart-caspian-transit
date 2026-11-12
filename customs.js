const customsSection = document.createElement("section");

customsSection.className = "card";
customsSection.style.marginTop = "24px";

customsSection.innerHTML = `
  <h2>Предварительная проверка документов</h2>

  <p class="muted">
    Введи сведения из документов груза SCT-001.
    Сравниваем вес нетто в тоннах с карточкой груза.
  </p>

  <form id="customs-form">
    <div class="fields">
      <label>
        Номер инвойса
        <input
          name="invoiceNumber"
          maxlength="100"
          placeholder="INV-001"
          required
        >
      </label>

      <label>
        Номер упаковочного листа
        <input
          name="packingListNumber"
          maxlength="100"
          placeholder="PL-001"
          required
        >
      </label>

      <label>
        Вес нетто в инвойсе, т
        <input
          name="invoiceWeightTonnes"
          type="number"
          min="0.001"
          max="100000"
          step="0.001"
          placeholder="12"
          required
        >
      </label>

      <label>
        Вес нетто в упаковочном листе, т
        <input
          name="packingWeightTonnes"
          type="number"
          min="0.001"
          max="100000"
          step="0.001"
          placeholder="12"
          required
        >
      </label>
    </div>

    <button type="submit">Проверить сведения</button>
  </form>

  <p
    id="customs-status"
    role="status"
    aria-live="polite"
  ></p>

  <ul id="customs-checks"></ul>

  <small>
    Проверяем только введённые сведения.
    Файлы не загружаются, подлинность документов не проверяется.
    Результат не отправляется в таможню
    и история проверок сохраняется на сервере.
  </small>
`;

document.querySelector("main").append(customsSection);

const customsForm = document.querySelector("#customs-form");
const customsStatus = document.querySelector("#customs-status");
const customsChecks = document.querySelector("#customs-checks");

customsForm.addEventListener("input", () => {
  customsStatus.textContent =
    "Сведения изменены. Выполни проверку заново.";

  customsStatus.style.color = "";
  customsChecks.replaceChildren();
});

customsForm.addEventListener("submit", async event => {
  event.preventDefault();

  const button = customsForm.querySelector("button");
  const inputs = customsForm.querySelectorAll("input");

  const data = Object.fromEntries(
    new FormData(customsForm)
  );

  inputs.forEach(input => {
    input.disabled = true;
  });

  button.disabled = true;
  customsChecks.replaceChildren();
  customsStatus.style.color = "";
  customsStatus.textContent = "Проверяем сведения…";

  try {
    const response = await fetch(
      "http://127.0.0.1:8000/api/customs/SCT-001/check",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify(data),
        signal: AbortSignal.timeout(10000)
      }
    );

    if (response.status === 422) {
      throw new Error(
        "Заполни номера документов и положительный вес " +
        "с точностью до 0,001 т."
      );
    }

    if (!response.ok) {
      throw new Error(`Ошибка сервера: ${response.status}`);
    }

    const result = await response.json();
    document.dispatchEvent(new Event("customs-check-saved"));

    customsStatus.textContent =
      `${result.message}. ` +
      `Вес груза: ${result.cargoWeightTonnes} т. ` +
      "В таможню не отправлено.";

    customsStatus.style.color =
      result.status === "ready_for_demo_submission"
        ? "#a7f3d0"
        : "#fde68a";

    for (const check of result.checks) {
      const item = document.createElement("li");

      item.textContent =
        `${check.passed ? "✓" : "✕"} ${check.title}`;

      item.style.color = check.passed
        ? "#a7f3d0"
        : "#fde68a";

      customsChecks.append(item);
    }
  } catch (error) {
    const connectionError =
      error instanceof TypeError ||
      error.name === "TimeoutError";

    customsStatus.textContent = connectionError
      ? "Нет связи с API. Проверь Python-сервер на порту 8000 " +
        "и повтори проверку."
      : error.message;
  } finally {
    inputs.forEach(input => {
      input.disabled = false;
    });

    button.disabled = false;
  }
});