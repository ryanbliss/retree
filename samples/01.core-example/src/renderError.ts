export function renderError(elem: HTMLElement, error: Error) {
    const errorTemplate = document.createElement("template");
    errorTemplate["innerHTML"] = `
    <div class="wrapper error">
        <p class="error-title">Something went wrong</p>
        <p class="error-text"></p>
        <button class="refresh"> Try again </button>
    </div>
    `;

    elem.appendChild(errorTemplate.content.cloneNode(true));
    const refreshButton = elem.querySelector<HTMLButtonElement>(".refresh")!;
    const errorText = elem.querySelector(".error-text")!;

    // Refresh the page on click
    refreshButton.onclick = () => {
        window.location.reload();
    };
    console.error(error);
    const errorTextContent = error.toString();
    errorText.textContent = errorTextContent;
}
