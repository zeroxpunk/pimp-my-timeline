export type TweetState = 'pending' | 'approved' | 'hidden';

function getWrapper(article: HTMLElement): HTMLElement {
  let wrapper = article.parentElement;
  if (wrapper?.classList.contains('pimp-overlay-wrapper')) {
    return wrapper;
  }

  wrapper = document.createElement('div');
  wrapper.className = 'pimp-overlay-wrapper';
  article.parentElement?.insertBefore(wrapper, article);
  wrapper.appendChild(article);
  return wrapper;
}

function clearOverlays(article: HTMLElement) {
  const wrapper = article.parentElement;
  if (wrapper?.classList.contains('pimp-overlay-wrapper')) {
    wrapper.querySelector('.pimp-spinner')?.remove();
    wrapper.querySelector('.pimp-hidden-overlay')?.remove();
  }
}

function setState(article: HTMLElement, state: TweetState) {
  article.dataset.pimpPending = state === 'pending' ? 'true' : '';
  article.dataset.pimpApproved = state === 'approved' ? 'true' : '';
  article.dataset.pimpHidden = state === 'hidden' ? 'true' : '';
}

export function getState(article: HTMLElement): TweetState | null {
  if (article.dataset.pimpPending === 'true') return 'pending';
  if (article.dataset.pimpApproved === 'true') return 'approved';
  if (article.dataset.pimpHidden === 'true') return 'hidden';
  return null;
}

export function resetState(article: HTMLElement) {
  setState(article, 'approved');
  article.dataset.pimpPending = '';
  article.dataset.pimpApproved = '';
  article.dataset.pimpHidden = '';
  clearOverlays(article);
}

export function setPending(article: HTMLElement) {
  setState(article, 'pending');
  const wrapper = getWrapper(article);

  if (!wrapper.querySelector('.pimp-spinner')) {
    const spinner = document.createElement('div');
    spinner.className = 'pimp-spinner';
    spinner.innerHTML = '<div class="pimp-spinner-ring"></div>';
    wrapper.appendChild(spinner);
  }
}

export function setApproved(article: HTMLElement) {
  setState(article, 'approved');
  clearOverlays(article);
}

export function setBlocked(article: HTMLElement, reason: string) {
  setState(article, 'hidden');
  const wrapper = getWrapper(article);
  clearOverlays(article);

  const overlay = document.createElement('div');
  overlay.className = 'pimp-hidden-overlay';

  const card = document.createElement('div');
  card.className = 'pimp-hidden-card';

  const title = document.createElement('div');
  title.className = 'pimp-hidden-title';
  title.textContent = 'Hidden';

  const reasonEl = document.createElement('div');
  reasonEl.className = 'pimp-hidden-reason';
  reasonEl.textContent = reason;

  const btn = document.createElement('button');
  btn.className = 'pimp-show-btn';
  btn.textContent = 'Reveal';
  btn.addEventListener('click', (e) => {
    e.stopPropagation();
    e.preventDefault();
    setApproved(article);
  });

  card.appendChild(title);
  card.appendChild(reasonEl);
  card.appendChild(btn);
  overlay.appendChild(card);
  wrapper.appendChild(overlay);
}

