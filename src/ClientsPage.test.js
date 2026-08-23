import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ClientsPage } from './App';

// Regression test for the "Add Client" input losing keystrokes: ClientForm
// used to be declared inside ClientsPage's render body, so every keystroke
// (setForm -> re-render -> new ClientForm identity) unmounted/remounted the
// <input>, dropping focus after each character. ClientForm now lives at
// module scope so its identity is stable across renders.
test('admin can type a full client name into the Add Client modal', () => {
  const db = { clients: [], accountManagers: [] };

  render(
    <ClientsPage isOwner={true} db={db} onRefresh={async () => {}} user={{ email: 'admin@test.com' }} />
  );

  userEvent.click(screen.getByText('+ Add Client'));

  const nameInput = screen.getByPlaceholderText('e.g. Eden Health');
  userEvent.type(nameInput, 'Eden Health');

  expect(nameInput).toHaveValue('Eden Health');
});
