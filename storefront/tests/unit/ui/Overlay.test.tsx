// @vitest-environment jsdom
import {useState} from 'react';
import {cleanup, fireEvent, render, screen} from '@testing-library/react';
import {afterEach, describe, expect, it, vi} from 'vitest';
import {Dialog} from '~/components/ui/Dialog';
import {Drawer} from '~/components/ui/Drawer';

afterEach(cleanup);

// REQ-NAV-001: header, menu and drawer fully keyboard-operable. Drawer and Dialog share one Overlay, tested here.
function DrawerHarness({onClose}: {onClose?: () => void}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" onClick={() => setOpen(true)}>
        Open cart
      </button>
      <main>
        <a href="#behind">Behind the drawer</a>
      </main>
      <Drawer
        open={open}
        onClose={() => {
          onClose?.();
          setOpen(false);
        }}
        title="Cart"
      >
        <button type="button">First action</button>
        <input aria-label="Middle field" />
        <button type="button">Last action</button>
      </Drawer>
    </>
  );
}

function openDrawer() {
  const opener = screen.getByRole('button', {name: 'Open cart'});
  opener.focus();
  fireEvent.click(opener);
  return opener;
}

describe('<Drawer>', () => {
  it('mounts nothing while closed', () => {
    render(<DrawerHarness />);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('opens as a labelled modal dialog and moves focus inside (the first control is Close)', () => {
    render(<DrawerHarness />);
    openDrawer();
    const dialog = screen.getByRole('dialog', {name: 'Cart'});
    expect(dialog).toHaveAttribute('aria-modal', 'true');
    expect(screen.getByRole('button', {name: 'Close'})).toHaveFocus();
  });

  it('traps Tab and Shift+Tab inside the panel', () => {
    render(<DrawerHarness />);
    openDrawer();
    const close = screen.getByRole('button', {name: 'Close'});
    const last = screen.getByRole('button', {name: 'Last action'});

    last.focus();
    fireEvent.keyDown(last, {key: 'Tab'});
    expect(close).toHaveFocus(); // forward from the last control wraps to the first

    fireEvent.keyDown(close, {key: 'Tab', shiftKey: true});
    expect(last).toHaveFocus(); // backward from the first wraps to the last
  });

  it('pulls focus back in if it somehow sits outside the panel', () => {
    render(<DrawerHarness />);
    openDrawer();
    const behind = screen.getByText('Behind the drawer');
    behind.focus();
    fireEvent.keyDown(behind, {key: 'Tab'});
    expect(screen.getByRole('button', {name: 'Close'})).toHaveFocus();
  });

  it('makes the page behind inert and locks page scroll while open, then restores both', () => {
    const {container} = render(<DrawerHarness />);
    openDrawer();
    expect(container).toHaveAttribute('inert');
    expect(document.body.style.overflow).toBe('hidden');

    fireEvent.keyDown(document, {key: 'Escape'});
    expect(container).not.toHaveAttribute('inert');
    expect(document.body.style.overflow).toBe('');
  });

  it('closes on Escape and returns focus to the control that opened it', () => {
    const onClose = vi.fn();
    render(<DrawerHarness onClose={onClose} />);
    const opener = openDrawer();
    fireEvent.keyDown(document, {key: 'Escape'});
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(opener).toHaveFocus();
  });

  it('closes with the Close button and returns focus', () => {
    render(<DrawerHarness />);
    const opener = openDrawer();
    fireEvent.click(screen.getByRole('button', {name: 'Close'}));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(opener).toHaveFocus();
  });

  it('closes when the backdrop is pressed and released, not when a drag ends there', () => {
    const onClose = vi.fn();
    render(<DrawerHarness onClose={onClose} />);
    openDrawer();
    const dialog = screen.getByRole('dialog');
    const backdrop = dialog.parentElement as HTMLElement;

    fireEvent.mouseDown(dialog); // press starts inside the panel
    fireEvent.click(backdrop);
    expect(onClose).not.toHaveBeenCalled();

    fireEvent.mouseDown(backdrop);
    fireEvent.click(backdrop);
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});

describe('<Dialog>', () => {
  it('is named by its title, described by its description and closes on Escape with focus returned', () => {
    function Harness() {
      const [open, setOpen] = useState(false);
      return (
        <>
          <button type="button" onClick={() => setOpen(true)}>
            Open
          </button>
          <Dialog
            open={open}
            onClose={() => setOpen(false)}
            title="Delivery ZIP code"
            description="We use it to show delivery options."
          >
            <input aria-label="ZIP" />
          </Dialog>
        </>
      );
    }
    render(<Harness />);
    const opener = screen.getByRole('button', {name: 'Open'});
    opener.focus();
    fireEvent.click(opener);

    const dialog = screen.getByRole('dialog', {name: 'Delivery ZIP code'});
    expect(dialog).toHaveAccessibleDescription(
      'We use it to show delivery options.',
    );

    fireEvent.keyDown(document, {key: 'Escape'});
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(opener).toHaveFocus();
  });

  it('only the top-most of two stacked overlays reacts to Escape', () => {
    function Stack() {
      const [inner, setInner] = useState(true);
      const [outer, setOuter] = useState(true);
      return (
        <>
          <Drawer open={outer} onClose={() => setOuter(false)} title="Outer">
            <p>outer</p>
          </Drawer>
          <Dialog open={inner} onClose={() => setInner(false)} title="Inner">
            <p>inner</p>
          </Dialog>
        </>
      );
    }
    render(<Stack />);
    expect(screen.getAllByRole('dialog', {hidden: true})).toHaveLength(2);
    fireEvent.keyDown(document, {key: 'Escape'});
    expect(screen.getAllByRole('dialog', {hidden: true})).toHaveLength(1);
    expect(
      screen.getByRole('dialog', {hidden: true, name: 'Outer'}),
    ).toBeInTheDocument();
  });
});
