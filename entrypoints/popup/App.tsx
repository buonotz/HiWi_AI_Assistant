function App() {
  return (
    <main className="popup">
      <header>
        <h1>HiWi AI Assistant</h1>
        <p>Analyze research and student job postings.</p>
      </header>

      <section className="actions">
        <button type="button" disabled>
          Analyze Current Job
        </button>

        <button type="button" disabled>
          Manage Profile
        </button>
      </section>

      <p className="status">
        Sprint 1: Browser extension setup
      </p>
    </main>
  );
}

export default App;
