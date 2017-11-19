import { Card, CardState, generate_cards, CARD_SCALE, SWAP_HOVER } from "card";
import { PlayerState, generate_players, Hand, InPlay } from "player";
import { randomInt, clone_object } from "utils";
import { TiledLayout, LayoutDirection } from "layout";
import { REGEX_STRING_TEXT_FONT, PLAYER_COUNT, FIRST_PLAYER, SECOND_PLAYER, GamePhase } from "constants";
import { play_as_computer } from "./computer";

let mouse = {
    x: 0,
    y: 0
};

let stage_width = 0;
let stage_height = 0;

let input_disable = 0;

function oppositePlayer(player: number): number {
    return 1 - player;
}

export class GameState {
    // Index of the current player.
    current_player: number;

    // Cards on the table.
    cards_inplay: Array<InPlay>;

    // Cards in the hand.
    cards_inhand: Array<Hand>;

    // States of the players (e.g. hp, decks).
    player_states: Array<PlayerState>;

    // Currently selected cards.
    selected_cards: Array<Card>;

    // Map from id to the card;
    id_to_card: { [key: number]: Card };

    // Container showing cards in play.
    battlefield_container: createjs.Container;

    // Is computer making a move now.
    computer_thinking: boolean;

    // Current regex string.
    regex_string_text: createjs.Text;

    // Number of current half round (total number of actions all players made).
    half_round_index: number;

    phase: GamePhase;

    constructor(game_field: createjs.Container) {
        this.current_player = FIRST_PLAYER;

        this.cards_inplay = new Array<InPlay>(PLAYER_COUNT);
        this.cards_inplay[FIRST_PLAYER] = new InPlay(generate_cards(3));
        this.cards_inplay[SECOND_PLAYER] = new InPlay(generate_cards(3));

        this.cards_inhand = new Array<Hand>(PLAYER_COUNT);
        this.cards_inhand[FIRST_PLAYER] = new Hand(generate_cards(4));
        this.cards_inhand[SECOND_PLAYER] = new Hand(generate_cards(4));

        this.player_states = generate_players();

        this.selected_cards = [];

        this.id_to_card = {};

        this.computer_thinking = false;

        this.regex_string_text = new createjs.Text("--------------", REGEX_STRING_TEXT_FONT, "red");

        for (let i = 0; i < PLAYER_COUNT; ++i) {
            // cards in play
            {
                let cards = this.cards_inplay[i].cards;
                let container = this.cards_inplay[i].container;
                for (let j = 0; j < cards.length; ++j) {
                    let id = cards[j].id;
                    cards[j].container.on("click", (event) => {
                        this.select_card(i, id, false);
                    });
                    this.add_card(cards[j]);
                }
            }

            // cards in hands
            {
                let cards = this.cards_inhand[i].cards;
                let container = this.cards_inhand[i].container;
                for (let j = 0; j < cards.length; ++j) {
                    let id = cards[j].id;
                    cards[j].container.on("click", (event) => {
                        this.select_card(i, id, false);
                    });
                    this.add_card(cards[j]);
                    if (i === SECOND_PLAYER) {
                        cards[j].set_visible(false);
                    }
                }
            }
        }

        createjs.Ticker.on("tick", function(event) {
            if (input_disable) return;
            for (let i = 0; i < PLAYER_COUNT; ++i) {
                for (let card of this.cards_inplay[i].cards) {
                    card.update_hover(mouse);
                }

                for (let card of this.cards_inhand[i].cards) {
                    card.update_hover(mouse);
                }
            }
        }, this);

        let verticalLayout = new TiledLayout(LayoutDirection.Vertical, 35, true, stage_width);
        verticalLayout.addItem(this.player_states[SECOND_PLAYER].container);
        verticalLayout.addItem(this.cards_inhand[SECOND_PLAYER].container, -20);
        verticalLayout.addItem(this.cards_inplay[SECOND_PLAYER].container);
        verticalLayout.addItem(this.regex_string_text);
        verticalLayout.addItem(this.cards_inplay[FIRST_PLAYER].container);
        verticalLayout.addItem(this.cards_inhand[FIRST_PLAYER].container);
        verticalLayout.addItem(this.player_states[FIRST_PLAYER].container, -20);

        verticalLayout.apply_centering();

        this.battlefield_container = verticalLayout;

        game_field.addChild(this.battlefield_container);

        this.half_round_index = 0;
        this.phase = GamePhase.Changing;
    }

    add_card(card: Card) {
        this.id_to_card[card.id] = card;
    }

    get_card(card_id: number): Card {
        if (this.id_to_card[card_id] === undefined) {
            console.error(`Can't find card ${card_id}`)
        }
        return this.id_to_card[card_id];
    }


    select_card(owner: number, card_id: number, is_computer: boolean): void {
        console.log(`Selecting card (${owner}, ${card_id})`);
        if ((this.computer_thinking || input_disable) && !is_computer) {
            return;
        }

        if (this.phase === GamePhase.Changing) {
            this.select_card_while_changing(owner, card_id, is_computer);
        } else if (this.phase == GamePhase.Matching) {
            this.select_card_while_matching(owner, card_id, is_computer);
        }
    }

    select_card_while_changing(owner: number, card_id: number, is_computer: boolean) {
        let players_hand = this.cards_inhand[this.current_player];
        let players_play = this.cards_inplay[this.current_player];
        let card_selected_for_swap_in_hand = players_hand.get_selected_for_swap();

        let card = this.get_card(card_id);
        if (owner !== this.current_player) {
            if (card_selected_for_swap_in_hand !== null) {
                console.log("You can not swap your card with your opponent's card");
                // you can not change other player's cards
            } else {
                console.log("Skip changing phase");
                // just skipping turn
                this.change_player();
            }
            return;
        }

        if (card.state === CardState.InPlay) {
            if (card_selected_for_swap_in_hand) {
                console.log("Swapping cards");
                // swapping cards
                this.swap_cards(owner, card_selected_for_swap_in_hand, card);
            }
        } else if (card.state === CardState.InHand) {
            console.log("Select for swap");
            if (card.selected_for_swap) {
                card.select_for_swap(false);
            } else {
                for (let k = 0; k < players_hand.cards.length; ++k) {
                    players_hand.cards[k].select_for_swap(false);
                }
                card.select_for_swap(true);
            }
        }
    }

    swap_cards(owner: number, card_in_hand: Card, card_in_play: Card) {
        input_disable++;

        card_in_hand.select_for_swap(false);
        card_in_play.select_for_swap(false);

        let origA = {x: card_in_hand.container.x, y: card_in_hand.container.y};
        let origB = {x: card_in_play.container.x, y: card_in_play.container.y};
        let posA = card_in_hand.container.localToGlobal(card_in_hand.container.getBounds().width / 2, card_in_hand.container.getBounds().height / 2);
        let posB = card_in_play.container.localToGlobal(card_in_play.container.getBounds().width / 2, card_in_play.container.getBounds().height / 2);

        let ai_move = (owner == SECOND_PLAYER);

        let inOut = createjs.Ease.getPowInOut(2);

        createjs.Tween.get(card_in_play.container)
            .to({
                scaleX: CARD_SCALE + SWAP_HOVER,
                scaleY: CARD_SCALE + SWAP_HOVER,
                rotation: 90,
                x: card_in_play.container.x - 800
            }, 500, inOut);
        createjs.Tween.get(card_in_hand.container)
            .to({
                scaleX: CARD_SCALE + SWAP_HOVER,
                scaleY: CARD_SCALE + SWAP_HOVER
            }, 500, inOut)
            .call(function(){
                if (ai_move) this.set_visible(true, true, false);
            }, null, card_in_hand)
            .to({
                x: card_in_hand.container.x + posB.x - posA.x,
                y: card_in_hand.container.y + posB.y - posA.y
            }, 600, inOut)
            .to({
                scaleX: CARD_SCALE,
                scaleY: CARD_SCALE
            }, 300, inOut)
            .call(function() {
                let players_hand = this.cards_inhand[owner];
                let players_play = this.cards_inplay[owner];
        
                //console.log("Before");
                //console.log("Card in hand: " + card_in_hand.id);
                //console.log("Card in play: " + card_in_play.id);
        
                let hand_card_index = players_hand.cards.indexOf(card_in_hand);
                let play_card_index = players_play.cards.indexOf(card_in_play);
                [players_hand.cards[hand_card_index], players_play.cards[play_card_index]] = [
                    players_play.cards[play_card_index],
                    players_hand.cards[hand_card_index]
                ];
        
                hand_card_index = players_hand.container.getChildIndex(card_in_hand.container);
                play_card_index = players_play.container.getChildIndex(card_in_play.container);
        
                players_hand.container.removeChild(card_in_hand.container);
                players_hand.container.addChildAt(card_in_play.container, hand_card_index);
        
                players_play.container.removeChild(card_in_play.container);
                players_play.container.addChildAt(card_in_hand.container, play_card_index);
        
                [card_in_hand.container.x, card_in_hand.container.y, card_in_play.container.x, card_in_play.container.y] = [
                    origB.x,
                    origB.y,
                    origA.x,
                    origA.y
                ]
        
                card_in_hand.change_state(CardState.InPlay);
                card_in_hand.hover = 0;
                
                //console.log("Before");
                //console.log("Card in hand: " + card_in_hand.id);
                //console.log("Card in play: " + card_in_play.id);

                this.discard_and_pick_new(owner, card_in_play);
                this.change_player();

                input_disable--;
            }, null, this);
    }

    discard_and_pick_new(owner: number, card_in_hand: Card) {
        let new_card = this.player_states[owner].pick_card_from_deck();
        if (new_card === null) {
            console.error("No card in deck!. Pls implement something here!");
        } else {
            this.cards_inhand[owner].change_card(card_in_hand, new_card);
            let id = new_card.id;
            new_card.container.on("click", (event) => {
                this.select_card(owner, id, false);
            });
            this.add_card(new_card);
            if (owner == SECOND_PLAYER) {
                new_card.set_visible(false);
            }
        }
    }

    select_card_while_matching(owner: number, card_id: number, is_computer: boolean) {
        let card = this.get_card(card_id);
        if (owner === this.current_player) {
            if (card.state === CardState.InPlay) {
                if (!card.selected) {
                    this.selected_cards.push(card);
                    card.select(this.selected_cards.length);
                } else {
                    let index = this.selected_cards.indexOf(card);
                    if (index + 1 === this.selected_cards.length) {
                        this.selected_cards.splice(index);
                        card.deselect();
                    }
                }
                this.regex_string_text.text = this.get_regex_string();
            }
        } else {
            if (card.state === CardState.InPlay) {
                this.attack(card);
                this.change_player();
            }
        }
    }

    change_player() {
        this.half_round_index += 1;

        if (this.half_round_index % 2 === 0) {
            console.log("Changing phase", this.half_round_index);
            this.change_phase();
        }

        this.current_player = oppositePlayer(this.current_player);
        if (this.half_round_index % 4 === 0) {
            console.log("Changing player", this.half_round_index);
            this.current_player = oppositePlayer(this.current_player);
        }

        if (this.current_player == SECOND_PLAYER) {
            play_as_computer(this);
        }
    }

    change_phase() {
        if (this.phase === GamePhase.Changing) {
            console.log("Matching phase started");
            this.phase = GamePhase.Matching;
        } else if (this.phase === GamePhase.Matching) {
            console.log("Changing phase started");
            this.phase = GamePhase.Changing;
        }
    }

    get_regex_string(): string {
        let regex_string = "";
        for (let i = 0; i < this.selected_cards.length; ++i) {
            regex_string += this.selected_cards[i].regex;
        }
        return regex_string;
    }

    attack(card: Card): void {
        let regex_string = this.get_regex_string();
        console.log(`Attacking "${card.password}" with "${regex_string}"`);

        let matches = card.password.match(new RegExp(regex_string, "g"));
        let max_match = "";
        if (matches) {
            for (const match of matches) {
                if (match.length > max_match.length) {
                    max_match = match;
                }
            }
        }
        console.log(`Max match: "${max_match}"`);

        this.player_states[oppositePlayer(this.current_player)].deal_damage(max_match.length);
        // card.remove_password(regex_string);

        for (let i = 0; i < this.selected_cards.length; ++i) {
            this.selected_cards[i].deselect();
        }
        this.selected_cards = [];
        this.regex_string_text.text = "";
    }
};

export function play() {
    let stage = new createjs.Stage('RegExkcdStage');
    stage.mouseEnabled = true;

    let canvas:any = stage.canvas;
    stage_width = canvas.width;
    stage_height = canvas.height;

    let game_field = new createjs.Container();
    let game = new GameState(game_field);
    stage.addChild(game_field);
    stage.update();

    stage.on("stagemousemove", function(event: any) {
        mouse.x = event.stageX;
        mouse.y = event.stageY;
    });

    createjs.Ticker.framerate = 60;
    createjs.Ticker.addEventListener("tick", stage);
}
