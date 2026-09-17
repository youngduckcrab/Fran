interface Props {
  /** 실패한 메시지에만 재번역을 띄운다. */
  canRetranslate: boolean;
  onExplain: () => void;
  onCopy: () => void;
  onRetranslate: () => void;
  onClose: () => void;
}

/** 말풍선을 길게 눌렀을 때 뜨는 메뉴. */
export default function MessageActions({
  canRetranslate,
  onExplain,
  onCopy,
  onRetranslate,
  onClose,
}: Props) {
  return (
    <div className="sheet" role="dialog" aria-label="메시지 메뉴" onClick={onClose}>
      <div className="sheet__panel actions" onClick={(event) => event.stopPropagation()}>
        <button type="button" className="actions__item" onClick={onExplain}>
          <b>설명</b>
          <span>단어와 문법을 뜯어봅니다</span>
        </button>
        <button type="button" className="actions__item" onClick={onCopy}>
          <b>복사</b>
        </button>
        {canRetranslate && (
          <button type="button" className="actions__item" onClick={onRetranslate}>
            <b>다시 번역</b>
          </button>
        )}
        <button type="button" className="actions__item actions__cancel" onClick={onClose}>
          닫기
        </button>
      </div>
    </div>
  );
}
